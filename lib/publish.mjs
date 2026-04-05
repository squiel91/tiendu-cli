import * as p from "@clack/prompts";
import { loadConfigOrFail, isBuiltTheme } from "./config.mjs";
import {
  fetchPreviewDetails,
  publishPreview,
  resolvePreviewKeyInteractively,
} from "./preview.mjs";
import { push } from "./push.mjs";

export const publish = async ({ skipBuild = false, previewKey: previewKeyArg } = {}) => {
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

  const confirmed = await p.confirm({
    message: previewUrl
      ? `Publish preview "${displayName}" (${previewKey}) at ${previewUrl} to the live storefront?`
      : `Publish preview "${displayName}" (${previewKey}) to the live storefront?`,
  });

  if (p.isCancel(confirmed) || !confirmed) {
    p.cancel("Publish cancelled.");
    process.exit(0);
  }

  if (await isBuiltTheme()) {
    p.log.info(
      skipBuild
        ? "Syncing existing dist/ output to the preview before publishing..."
        : "Building and syncing the latest dist/ output before publishing...",
    );
    await push({ skipBuild, previewKey });
  }

  const spinner = p.spinner();
  spinner.start("Publishing preview to live storefront...");

  const result = await publishPreview(
    config.apiBaseUrl,
    credentials.apiKey,
    config.storeId,
    previewKey,
  );

  if (!result.ok) {
    spinner.stop("Publish failed.", 1);
    p.log.error(result.error);
    process.exit(1);
  }

  spinner.stop(`Preview ${previewKey} published. Your live storefront has been updated.`);
  if (previewUrl) {
    p.log.message(`  ${previewUrl}`);
  }
};
