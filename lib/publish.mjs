import { loadConfigOrFail, writeConfig } from "./config.mjs";
import { publishPreview } from "./preview.mjs";

export const publish = async () => {
  const { config, credentials } = await loadConfigOrFail();

  if (!config.previewKey) {
    console.error("No hay preview activo. Creá uno con: tiendu preview create");
    process.exit(1);
  }

  console.log("");
  console.log(`Publicando preview ${config.previewKey} al storefront live...`);

  const result = await publishPreview(
    config.apiBaseUrl,
    credentials.apiKey,
    config.storeId,
    config.previewKey,
  );

  if (!result.ok) {
    console.error(`Error: ${result.error}`);
    process.exit(1);
  }

  console.log("Preview publicado. El storefront live fue actualizado.");
  console.log("Todos los previews de esta tienda fueron eliminados.");
  console.log("");

  // Remove preview key from config
  const { previewKey, ...rest } = config;
  await writeConfig(rest);
};
