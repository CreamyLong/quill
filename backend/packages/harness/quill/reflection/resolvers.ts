/**
 * Reflection helpers: resolve variables and classes from a string path.
 *
 * Faithful port of ``quill/reflection/resolvers.py``. The Python original
 * uses ``importlib.import_module`` (synchronous, dotted-path Python modules).
 * The TS runtime has no synchronous module loader, so this uses the ESM dynamic
 * ``import()`` and is therefore ASYNC. Module specifiers follow Node's ESM
 * resolution (package names / file paths), not Python's dotted-path convention.
 */

/** Raised when a module/variable path cannot be imported (mirrors Python ImportError). */
export class ImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportError";
  }
}

/** Raised when a resolved value fails validation (mirrors Python ValueError). */
export class ValueError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValueError";
  }
}

type Constructor = abstract new (...args: never[]) => object;

const MODULE_TO_PACKAGE_HINTS: Record<string, string> = {
  langchain_google_genai: "langchain-google-genai",
  langchain_anthropic: "langchain-anthropic",
  langchain_openai: "langchain-openai",
  langchain_deepseek: "langchain-deepseek",
};

function errorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}

function typeNameOf(value: unknown): string {
  if (value === null) {
    return "null";
  }
  const ctorName = (value as { constructor?: { name?: string } })?.constructor?.name;
  return ctorName ?? typeof value;
}

/**
 * True when a dynamic ``import()`` failed because the module was not found.
 *
 * Mirrors Python's ``isinstance(err, ModuleNotFoundError)`` branch.
 */
function isModuleNotFound(err: unknown): boolean {
  if (err == null || typeof err !== "object") {
    return false;
  }
  const code = (err as { code?: unknown }).code;
  return code === "ERR_MODULE_NOT_FOUND" || code === "MODULE_NOT_FOUND";
}

/** Build an actionable hint when module import fails. */
function buildMissingDependencyHint(modulePath: string, _err: unknown): string {
  const moduleRoot = modulePath.split(".")[0] ?? modulePath;
  // Python reads the missing-module name from ``ImportError.name``; JS import
  // errors do not expose it, so we fall back to the module root.
  const missingModule = moduleRoot;

  // Prefer provider package hints for known integrations, even when the import
  // error is triggered by a transitive dependency (e.g. `google`).
  let packageName: string | undefined = MODULE_TO_PACKAGE_HINTS[moduleRoot];
  if (packageName === undefined) {
    packageName = MODULE_TO_PACKAGE_HINTS[missingModule] ?? missingModule.replace(/_/g, "-");
  }

  return `Missing dependency '${missingModule}'. Install it with \`uv add ${packageName}\` (or \`pip install ${packageName}\`), then restart Quill.`;
}

/**
 * Resolve a variable from a path.
 *
 * @param variablePath The path to the variable (e.g. "module_name:variable_name").
 * @param expectedType Optional constructor (or list of constructors) to validate
 *   the resolved variable against, using ``instanceof``.
 * @returns The resolved variable.
 * @throws ImportError If the module path is invalid or the attribute doesn't exist.
 * @throws ValueError If the resolved variable doesn't pass the validation checks.
 */
export async function resolveVariable<T = unknown>(
  variablePath: string,
  expectedType?: Constructor | ReadonlyArray<Constructor>
): Promise<T> {
  const sepIndex = variablePath.lastIndexOf(":");
  if (sepIndex === -1) {
    throw new ImportError(
      `${variablePath} doesn't look like a variable path. Example: parent_package_name.sub_package_name.module_name:variable_name`
    );
  }
  const modulePath = variablePath.slice(0, sepIndex);
  const variableName = variablePath.slice(sepIndex + 1);

  let module: Record<string, unknown>;
  try {
    module = (await import(modulePath)) as Record<string, unknown>;
  } catch (err) {
    if (isModuleNotFound(err)) {
      const hint = buildMissingDependencyHint(modulePath, err);
      throw new ImportError(`Could not import module ${modulePath}. ${hint}`);
    }
    // Preserve the original error message for non-missing-module failures.
    throw new ImportError(`Error importing module ${modulePath}: ${errorMessage(err)}`);
  }

  if (!(variableName in module)) {
    throw new ImportError(`Module ${modulePath} does not define a ${variableName} attribute/class`);
  }
  const variable = module[variableName];

  // Type validation
  if (expectedType !== undefined) {
    const types = Array.isArray(expectedType)
      ? (expectedType as ReadonlyArray<Constructor>)
      : [expectedType as Constructor];
    const ok = types.some((t) => variable instanceof t);
    if (!ok) {
      const typeName = types.map((t) => (t as { name?: string }).name ?? "unknown").join(" or ");
      throw new ValueError(
        `${variablePath} is not an instance of ${typeName}, got ${typeNameOf(variable)}`
      );
    }
  }

  return variable as T;
}

function isSubclass(cls: Constructor, base: Constructor): boolean {
  if (cls === base) {
    return true;
  }
  const proto = (cls as { prototype?: unknown }).prototype;
  return proto instanceof (base as abstract new (...args: never[]) => object);
}

/**
 * Resolve a class from a module path and class name.
 *
 * @param classPath The path to the class (e.g. "langchain_openai:ChatOpenAI").
 * @param baseClass The base class to check the resolved class is a subclass of.
 * @returns The resolved class.
 * @throws ImportError If the module path is invalid or the attribute doesn't exist.
 * @throws ValueError If the resolved object is not a class or not a subclass of baseClass.
 */
export async function resolveClass<T = unknown>(
  classPath: string,
  baseClass?: Constructor
): Promise<new (...args: never[]) => T> {
  const modelClass = await resolveVariable(classPath);

  // Python checks ``isinstance(model_class, type)`` (i.e. it is a class). The TS
  // analogue is "the resolved value is a constructor function".
  if (typeof modelClass !== "function") {
    throw new ValueError(`${classPath} is not a valid class`);
  }

  if (baseClass !== undefined && !isSubclass(modelClass as unknown as Constructor, baseClass)) {
    const baseName = (baseClass as { name?: string }).name ?? "base class";
    throw new ValueError(`${classPath} is not a subclass of ${baseName}`);
  }

  return modelClass as unknown as new (...args: never[]) => T;
}
