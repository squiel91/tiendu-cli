const INSTANCE_FILE_PATTERNS = [
  /^templates\/[^/]+\.json$/,
  /^sections\/[^/]+\.json$/,
  /^config\/settings_data\.json$/,
];

export const isInstanceFile = (relativePath) => {
  const normalized = relativePath.split(/[\\/]/).join("/");
  return INSTANCE_FILE_PATTERNS.some((pattern) => pattern.test(normalized));
};
