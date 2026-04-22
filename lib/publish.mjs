import { loadConfigOrFail } from "./config.mjs";
import {
  fetchPreviewDetails,
  publishPreview,
  resolvePreviewKeyInteractively,
} from "./preview.mjs";
import { push } from "./push.mjs";
import * as ui from "./ui.mjs";

export const publish = async ({ skipBuild = false, previewKey: previewKeyArg, skipInstances = false } = {}) => {
  const { config, credentials } = await loadConfigOrFail();

  // Resolve preview key: explicit arg > interactive picker
  const previewKey = previewKeyArg ?? await resolvePreviewKeyInteractively({ config, credentials });

  // Fetch preview to show its name in the confirmation
  const fetchResult = await fetchPreviewDetails(
    config.apiBaseUrl,
    credentials.apiKey,
    config.storeId,
    previewKey,
  );

  const displayName = fetchResult.ok
    ? fetchResult.data.displayName
    : previewKey;
  const previewUrl = fetchResult.ok ? fetchResult.data.url : null;

  const confirmed = await ui.confirm({
    message: previewUrl
      ? `Publish preview "${displayName}" (${previewKey}) at ${previewUrl} to the live storefront?`
      : `Publish preview "${displayName}" (${previewKey}) to the live storefront?`,
  });

  if (ui.isCancel(confirmed) || !confirmed) {
    ui.cancel("Publish cancelled.");
    process.exit(0);
  }

  ui.log.info(
    skipBuild
      ? "Syncing existing dist/ output to the preview before publishing..."
      : "Building and syncing the latest dist/ output before publishing...",
  );
  await push({ skipBuild, previewKey, skipInstances });

  const spinner = ui.spinner();
  spinner.start("Publishing preview to live storefront...");

  const result = await publishPreview(
    config.apiBaseUrl,
    credentials.apiKey,
    config.storeId,
    previewKey,
  );

  if (!result.ok) {
    spinner.stop("Publish failed.", 1);
    ui.log.error(result.error);
    process.exit(1);
  }

  spinner.stop(`Preview ${previewKey} published. Your live storefront has been updated.`);
  if (previewUrl) {
    ui.log.message(`  ${previewUrl}`);
  }
};
