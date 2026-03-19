import * as p from "@clack/prompts";
import { loadConfigOrFail, writeConfig } from "./config.mjs";
import { publishPreview } from "./preview.mjs";

export const publish = async () => {
  const { config, credentials } = await loadConfigOrFail();

  if (!config.previewKey) {
    p.log.error("No active preview. Create one with: tiendu preview create");
    process.exit(1);
  }

  const confirmed = await p.confirm({
    message: `Publish preview ${config.previewKey} to the live storefront?`,
  });

  if (p.isCancel(confirmed) || !confirmed) {
    p.cancel("Publish cancelled.");
    process.exit(0);
  }

  const spinner = p.spinner();
  spinner.start("Publishing preview...");

  const result = await publishPreview(
    config.apiBaseUrl,
    credentials.apiKey,
    config.storeId,
    config.previewKey,
  );

  if (!result.ok) {
    spinner.stop("Publish failed.", 1);
    p.log.error(result.error);
    process.exit(1);
  }

  spinner.stop("Preview published. Your live storefront has been updated.");
  p.log.info("All previews for this store have been removed.");

  // Remove preview key from config
  const { previewKey, ...rest } = config;
  await writeConfig(rest);
};
