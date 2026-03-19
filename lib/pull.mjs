import { loadConfigOrFail } from "./config.mjs";
import { downloadStorefrontArchive } from "./api.mjs";
import { extractZip } from "./zip.mjs";

export const pull = async () => {
  const { config, credentials } = await loadConfigOrFail();

  console.log("");
  console.log(`Descargando tema de tienda #${config.storeId}...`);

  const result = await downloadStorefrontArchive(
    config.apiBaseUrl,
    credentials.apiKey,
    config.storeId,
  );

  if (!result.ok) {
    console.error(`Error: ${result.error}`);
    process.exit(1);
  }

  console.log(`Archivo ZIP recibido (${formatBytes(result.data.length)})`);
  console.log("Extrayendo archivos...");

  const outputDir = process.cwd();
  const extractedFiles = await extractZip(result.data, outputDir);

  console.log("");
  console.log(`${extractedFiles.length} archivos extraídos:`);
  for (const file of extractedFiles) {
    console.log(`  ${file}`);
  }
  console.log("");
};

/** @param {number} bytes */
const formatBytes = (bytes) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};
