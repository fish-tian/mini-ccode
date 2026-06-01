import type {
  ToolExecutionError,
  ToolInputSchema,
  ToolSchemaProperty
} from "./types.js";

export function validateToolInput(
  schema: ToolInputSchema,
  input: Readonly<Record<string, unknown>>
): ToolExecutionError | undefined {
  if (schema.type !== "object") {
    return invalidInput("Tool input schema must be an object schema.");
  }

  for (const field of schema.required ?? []) {
    if (!(field in input)) {
      return invalidInput(`Missing required field "${field}".`);
    }
  }

  for (const [field, property] of Object.entries(schema.properties ?? {})) {
    if (!(field in input)) {
      continue;
    }

    const error = validateProperty(field, input[field], property);
    if (error !== undefined) {
      return error;
    }
  }

  return undefined;
}

function validateProperty(
  path: string,
  value: unknown,
  property: ToolSchemaProperty
): ToolExecutionError | undefined {
  if (property.type === "array") {
    if (!Array.isArray(value)) {
      return invalidInput(`Expected "${path}" to be array.`);
    }

    if (property.items === undefined) {
      return undefined;
    }

    for (const [index, item] of value.entries()) {
      const error = validateProperty(`${path}[${index}]`, item, property.items);
      if (error !== undefined) {
        return error;
      }
    }

    return undefined;
  }

  if (property.type === "object") {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return invalidInput(`Expected "${path}" to be object.`);
    }

    const objectValue = value as Readonly<Record<string, unknown>>;

    for (const field of property.required ?? []) {
      if (!(field in objectValue)) {
        return invalidInput(`Missing required field "${path}.${field}".`);
      }
    }

    for (const [field, childProperty] of Object.entries(property.properties ?? {})) {
      if (!(field in objectValue)) {
        continue;
      }

      const error = validateProperty(`${path}.${field}`, objectValue[field], childProperty);
      if (error !== undefined) {
        return error;
      }
    }

    return undefined;
  }

  if (typeof value !== property.type) {
    return invalidInput(`Expected "${path}" to be ${property.type}.`);
  }

  return undefined;
}

function invalidInput(message: string): ToolExecutionError {
  return {
    code: "invalid_input",
    message
  };
}
