import { access, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

const POSTCSS_CONFIG_FILES = [
  "postcss.config.mjs",
  "postcss.config.js",
  "postcss.config.cjs",
  "postcss.config.json",
];

const fileExists = async (filePath) => {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
};

const getProjectRequire = (rootDir) =>
  createRequire(path.join(rootDir, "package.json"));

const unwrapModule = (moduleNamespace) => moduleNamespace?.default ?? moduleNamespace;

const importProjectModule = async (rootDir, specifier) => {
  try {
    const requireFromProject = getProjectRequire(rootDir);
    const resolvedPath = requireFromProject.resolve(specifier);
    return await import(pathToFileURL(resolvedPath).href);
  } catch {
    return null;
  }
};

const instantiatePlugin = async (rootDir, pluginEntry, pluginOptions) => {
  if (!pluginEntry) return null;

  if (typeof pluginEntry === "string") {
    const moduleNamespace = await importProjectModule(rootDir, pluginEntry);
    if (!moduleNamespace) {
      throw new Error(
        `Could not resolve PostCSS plugin "${pluginEntry}" from the theme project.`,
      );
    }

    const pluginFactory = unwrapModule(moduleNamespace);
    if (typeof pluginFactory === "function") {
      return pluginOptions === undefined || pluginOptions === true
        ? pluginFactory()
        : pluginFactory(pluginOptions);
    }

    return pluginFactory;
  }

  if (Array.isArray(pluginEntry)) {
    const [nestedEntry, nestedOptions] = pluginEntry;
    return instantiatePlugin(rootDir, nestedEntry, nestedOptions);
  }

  if (typeof pluginEntry === "function") {
    return pluginOptions === undefined
      ? pluginEntry
      : pluginEntry(pluginOptions);
  }

  return pluginEntry;
};

const normalizePlugins = async (rootDir, plugins) => {
  if (!plugins) return [];

  if (Array.isArray(plugins)) {
    const resolvedPlugins = [];

    for (const pluginEntry of plugins) {
      const plugin = await instantiatePlugin(rootDir, pluginEntry);
      if (plugin) resolvedPlugins.push(plugin);
    }

    return resolvedPlugins;
  }

  if (typeof plugins === "object") {
    const resolvedPlugins = [];

    for (const [pluginName, pluginOptions] of Object.entries(plugins)) {
      if (!pluginOptions) continue;
      const plugin = await instantiatePlugin(rootDir, pluginName, pluginOptions);
      if (plugin) resolvedPlugins.push(plugin);
    }

    return resolvedPlugins;
  }

  return [];
};

const loadPostcssConfig = async (rootDir) => {
  for (const configFile of POSTCSS_CONFIG_FILES) {
    const configPath = path.join(rootDir, configFile);
    if (!(await fileExists(configPath))) continue;

    if (configFile.endsWith(".json")) {
      const raw = await readFile(configPath, "utf-8");
      return JSON.parse(raw);
    }

    const moduleNamespace = await import(pathToFileURL(configPath).href);
    let config = unwrapModule(moduleNamespace);

    if (typeof config === "function") {
      config = await config({ env: process.env.NODE_ENV ?? "development" });
    }

    return config ?? null;
  }

  return null;
};

export const createCssPostCssPlugin = async (rootDir) => {
  const postcssModule = await importProjectModule(rootDir, "postcss");
  if (!postcssModule) return null;

  const postcss = unwrapModule(postcssModule);
  const config = await loadPostcssConfig(rootDir);

  let plugins = [];
  if (config?.plugins) {
    plugins = await normalizePlugins(rootDir, config.plugins);
  } else {
    const tailwindModule = await importProjectModule(rootDir, "@tailwindcss/postcss");
    if (tailwindModule) {
      const tailwindPluginFactory = unwrapModule(tailwindModule);
      plugins = [
        typeof tailwindPluginFactory === "function"
          ? tailwindPluginFactory()
          : tailwindPluginFactory,
      ];
    }
  }

  if (plugins.length === 0) return null;

  return {
    name: "tiendu-postcss",
    setup(build) {
      build.onLoad({ filter: /\.css$/ }, async (args) => {
        const source = await readFile(args.path, "utf-8");
        const result = await postcss(plugins).process(source, {
          from: args.path,
        });

        return {
          contents: result.css,
          loader: "css",
          resolveDir: path.dirname(args.path),
        };
      });
    },
  };
};
