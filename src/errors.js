export class ApiError extends Error {
  constructor(status, code, message, fieldErrors) {
    super(message);
    this.status = status;
    this.code = code;
    this.fieldErrors = fieldErrors;
  }
}

export const unauthenticated = (message = "Authentication required", code = "UNAUTHENTICATED") =>
  new ApiError(401, code, message);
export const forbidden = (message = "You do not have permission to perform this action", code = "FORBIDDEN") =>
  new ApiError(403, code, message);
export const notFound = (message = "Resource not found") => new ApiError(404, "NOT_FOUND", message);
export const validationError = (fieldErrors, message = "Validation failed") =>
  new ApiError(422, "VALIDATION_ERROR", message, fieldErrors);

export function zodFieldErrors(error) {
  const fieldErrors = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "root";
    if (!fieldErrors[key]) fieldErrors[key] = issue.message;
  }
  return fieldErrors;
}

export function parseOrThrow(schema, data) {
  const result = schema.safeParse(data);
  if (!result.success) throw validationError(zodFieldErrors(result.error));
  return result.data;
}

export function notFoundHandler(req, _res, next) {
  next(notFound(`Route ${req.method} ${req.path} not found`));
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, _req, res, _next) {
  if (err instanceof ApiError) {
    const body = { error: { code: err.code, message: err.message } };
    if (err.fieldErrors) body.error.fieldErrors = err.fieldErrors;
    return res.status(err.status).json(body);
  }
  if (err?.type === "entity.parse.failed") {
    return res.status(400).json({ error: { code: "INVALID_JSON", message: "Request body is not valid JSON" } });
  }
  console.error(err);
  res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Something went wrong on the server" } });
}
