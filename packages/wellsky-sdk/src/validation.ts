import { WellSkyError } from "./runtime.js";

export interface Schema {
  $ref?: string;
  type?: string;
  format?: string;
  nullable?: boolean;
  properties?: Record<string, Schema>;
  required?: string[];
  items?: Schema;
  additionalProperties?: boolean | Schema;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  default?: unknown;
  enum?: unknown[];
}

export type SchemaRegistry = Record<string, Schema>;
export type Method = "GET" | "POST" | "PUT" | "DELETE" | "PATCH" | "HEAD" | "OPTIONS";
export interface OperationDefinition {
  method: Method;
  path: string;
  authenticated: boolean;
  pathSchema: Schema;
  querySchema: Schema;
  bodySchema?: Schema;
  responseSchema?: Schema;
  multipart: boolean;
  pageable: boolean;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Validates the structural subset used by the pinned specifications. */
export function matches(value: unknown, schema: Schema, registry: SchemaRegistry, mode: "request" | "response", depth = 0): boolean {
  if (depth > 100) return false;
  if (value === null && schema.nullable) return true;
  if (schema.$ref) {
    const target = registry[schema.$ref.split("/").at(-1) ?? ""];
    return target !== undefined && matches(value, target, registry, mode, depth + 1);
  }
  if (schema.enum && !schema.enum.includes(value)) return false;
  switch (schema.type?.toLowerCase()) {
    case "string":
      if (schema.format === "binary") return value instanceof Blob;
      if (typeof value !== "string") return false;
      // Format strings and .NET regexes are not portable business validation.
      return mode === "response" || ((schema.minLength === undefined || value.length >= schema.minLength) && (schema.maxLength === undefined || value.length <= schema.maxLength));
    case "integer": return typeof value === "number" && Number.isSafeInteger(value);
    case "number": return typeof value === "number" && Number.isFinite(value);
    case "boolean": return typeof value === "boolean";
    case "array": {
      const itemSchema = schema.items;
      return Array.isArray(value) && itemSchema !== undefined && value.every(item => matches(item, itemSchema, registry, mode, depth + 1));
    }
    case "object": {
      if (!isRecord(value)) return false;
      if (schema.required?.some(key => !Object.hasOwn(value, key) || value[key] === undefined)) return false;
      for (const [key, child] of Object.entries(schema.properties ?? {})) {
        if (Object.hasOwn(value, key) && value[key] !== undefined && !matches(value[key], child, registry, mode, depth + 1)) return false;
      }
      // Response fields added by WellSky are allowed. Request typos are rejected.
      if (mode === "request" && schema.additionalProperties === false && Object.keys(value).some(key => !Object.hasOwn(schema.properties ?? {}, key))) return false;
      return true;
    }
    default: return false;
  }
}

export function decodeResponse<T>(value: unknown, schema: Schema | undefined, registry: SchemaRegistry, operation: string): T {
  // No schema means the public return type is unknown; empty responses remain null.
  if (!schema || value === null) return value as T;
  let valid: boolean;
  if (Array.isArray(value)) valid = value.every(item => matches(item, schema, registry, "response"));
  else if (isRecord(value) && Object.hasOwn(value, "value")) {
    valid = Array.isArray(value.value) && value.value.every(item => matches(item, schema, registry, "response")) &&
      (value["@odata.count"] === undefined || typeof value["@odata.count"] === "number" && Number.isSafeInteger(value["@odata.count"]) && value["@odata.count"] >= 0) &&
      (value["@odata.nextLink"] === undefined || typeof value["@odata.nextLink"] === "string");
  } else if (isRecord(value) && (Object.hasOwn(value, "count") || Object.hasOwn(value, "values"))) {
    valid = typeof value.count === "number" && Number.isSafeInteger(value.count) && value.count >= 0 &&
      Array.isArray(value.values) && value.values.every(item => matches(item, schema, registry, "response"));
  } else valid = matches(value, schema, registry, "response");
  if (!valid) throw new WellSkyError("protocol", operation);
  // Generated return types and runtime schemas come from the same specification.
  return value as T;
}
