import * as readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import {
  readConfig,
  readCredentials,
  writeConfig,
  writeCredentials,
} from "./config.mjs";
import { fetchStoreInfo } from "./api.mjs";

export const init = async () => {
  const existingConfig = await readConfig();
  const existingCredentials = await readCredentials();

  const rl = readline.createInterface({ input: stdin, output: stdout });

  try {
    console.log("");
    console.log("Tiendu CLI — Inicialización");
    console.log("===========================");
    console.log("");

    // API key
    const defaultApiKey = existingCredentials?.apiKey ?? "";
    const apiKeyPrompt = defaultApiKey
      ? `API Key [${maskApiKey(defaultApiKey)}]: `
      : "API Key: ";
    const apiKeyInput = (await rl.question(apiKeyPrompt)).trim();
    const apiKey = apiKeyInput || defaultApiKey;

    if (!apiKey) {
      console.error("La API Key es requerida.");
      process.exit(1);
    }

    // API base URL
    const defaultBaseUrl = existingConfig?.apiBaseUrl ?? "https://tiendu.uy";
    const baseUrlInput = (
      await rl.question(`URL base de la API [${defaultBaseUrl}]: `)
    ).trim();
    const apiBaseUrl = normalizeBaseUrl(baseUrlInput || defaultBaseUrl);

    // Store ID
    const defaultStoreId = existingConfig?.storeId ?? "";
    const storeIdPrompt = defaultStoreId
      ? `Store ID [${defaultStoreId}]: `
      : "Store ID: ";
    const storeIdInput = (await rl.question(storeIdPrompt)).trim();
    const storeIdRaw = storeIdInput || String(defaultStoreId);
    const storeId = Number(storeIdRaw);

    if (!Number.isInteger(storeId) || storeId <= 0) {
      console.error("El Store ID debe ser un número entero positivo.");
      process.exit(1);
    }

    // Validate credentials against the server
    console.log("");
    console.log("Verificando credenciales...");

    const storeInfo = await fetchStoreInfo(apiBaseUrl, apiKey, storeId);
    if (!storeInfo.ok) {
      console.error(`Error: ${storeInfo.error}`);
      process.exit(1);
    }

    console.log(`Tienda: ${storeInfo.data.name} (ID: ${storeId})`);
    console.log("");

    // Save
    await writeConfig({ storeId, apiBaseUrl });
    await writeCredentials({ apiKey });

    console.log("Configuración guardada en .cli/");
    console.log("");
    console.log('Próximo paso: ejecutá "tiendu pull" para descargar el tema.');
    console.log("");
    console.log("Nota: habilitá el modo dev en la plataforma Tiendu");
    console.log(
      "(Ajustes > General) para que los datos del preview se muestren correctamente.",
    );
    console.log("");
  } finally {
    rl.close();
  }
};

/** @param {string} key */
const maskApiKey = (key) => {
  if (key.length <= 8) return "****";
  return key.slice(0, 4) + "..." + key.slice(-4);
};

/** @param {string} url */
const normalizeBaseUrl = (url) => {
  return url.endsWith("/") ? url.slice(0, -1) : url;
};
