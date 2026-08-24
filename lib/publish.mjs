import { loadConfigOrFail } from "./config.mjs";
import { publishPreview } from "./api.mjs";
import {
  fetchPreviewDetails,
  resolvePreviewKeyInteractively,
} from "./preview.mjs";
import { push } from "./push.mjs";
import * as ui from "./ui.mjs";

export const publish = async ({ previewKey: previewKeyArg, overrideState = false } = {}) => {
  const { config, credentials } = await loadConfigOrFail();

  const previewKey = previewKeyArg ?? await resolvePreviewKeyInteractively({ config, credentials });

  const fetchResult = await fetchPreviewDetails(
    config.apiBaseUrl,
    credentials.apiKey,
    config.storeHandle,
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

  ui.log.info("Syncing local files to the preview before publishing...");
  await push({ previewKey, overrideState });

  const spinner = ui.spinner();
  spinner.start("Publishing preview to live storefront...");

  const result = await publishPreview(
    config.apiBaseUrl,
    credentials.apiKey,
    config.storeHandle,
    previewKey,
    overrideState,
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
