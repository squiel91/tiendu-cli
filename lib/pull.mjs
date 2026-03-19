import * as p from "@clack/prompts";
import { loadConfigOrFail } from "./config.mjs";
import { downloadStorefrontArchive } from "./api.mjs";
import { extractZip } from "./zip.mjs";

/** @param {number} bytes */
const formatBytes = (bytes) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export const pull = async () => {
  const { config, credentials } = await loadConfigOrFail();

  const spinner = p.spinner();
  spinner.start(`Downloading theme from store #${config.storeId}...`);

  const result = await downloadStorefrontArchive(
    config.apiBaseUrl,
    credentials.apiKey,
    config.storeId,
  );

  if (!result.ok) {
    spinner.stop("Download failed.", 1);
    p.log.error(result.error);
    process.exit(1);
  }

  spinner.stop(
    `Archive received (${formatBytes(result.data.length)}). Extracting...`,
  );

  const outputDir = process.cwd();
  const extractedFiles = await extractZip(result.data, outputDir);

  p.log.success(
    `${extractedFiles.length} file${extractedFiles.length === 1 ? "" : "s"} extracted.`,
  );
};
