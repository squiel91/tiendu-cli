import * as p from "@clack/prompts";
import {
  readConfig,
  readCredentials,
  writeConfig,
  writeCredentials,
} from "./config.mjs";
import { fetchUserStores } from "./api.mjs";

/** @param {string} key */
const maskApiKey = (key) => {
  if (key.length <= 8) return "****";
  return key.slice(0, 4) + "..." + key.slice(-4);
};

/** @param {string} url */
const normalizeBaseUrl = (url) => {
  return url.endsWith("/") ? url.slice(0, -1) : url;
};

export const init = async () => {
  const existingConfig = await readConfig();
  const existingCredentials = await readCredentials();

  p.intro("Tiendu CLI — Inicialización");

  // ─── API Key ──────────────────────────────────────────────────────────────
  const apiKeyDefault = existingCredentials?.apiKey ?? "";

  const apiKeyInput = await p.password({
    message: "API Key",
    mask: "*",
    validate: (value) => {
      const resolved = value.trim() || apiKeyDefault;
      if (!resolved) return "La API Key es requerida.";
    },
  });

  if (p.isCancel(apiKeyInput)) {
    p.cancel("Inicialización cancelada.");
    process.exit(0);
  }

  const apiKey = apiKeyInput.trim() || apiKeyDefault;

  // ─── API Base URL ─────────────────────────────────────────────────────────
  const baseUrlDefault = existingConfig?.apiBaseUrl ?? "https://tiendu.uy";

  const baseUrlInput = await p.text({
    message: "URL base de la API",
    placeholder: baseUrlDefault,
    defaultValue: baseUrlDefault,
    validate: (value) => {
      const resolved = value.trim() || baseUrlDefault;
      try {
        new URL(resolved);
      } catch {
        return "URL inválida.";
      }
    },
  });

  if (p.isCancel(baseUrlInput)) {
    p.cancel("Inicialización cancelada.");
    process.exit(0);
  }

  const apiBaseUrl = normalizeBaseUrl(baseUrlInput.trim() || baseUrlDefault);

  // ─── Fetch stores (validates API key implicitly) ───────────────────────────
  const spinner = p.spinner();
  spinner.start("Verificando credenciales y obteniendo tiendas...");

  const storesResult = await fetchUserStores(apiBaseUrl, apiKey);

  if (!storesResult.ok) {
    spinner.stop("Error al verificar credenciales.", 1);
    p.cancel(storesResult.error);
    process.exit(1);
  }

  const stores = storesResult.data;

  if (stores.length === 0) {
    spinner.stop("No se encontraron tiendas.", 1);
    p.cancel("Tu API Key no tiene acceso a ninguna tienda.");
    process.exit(1);
  }

  spinner.stop(
    `${stores.length} tienda${stores.length === 1 ? "" : "s"} encontrada${stores.length === 1 ? "" : "s"}.`,
  );

  // ─── Select store ─────────────────────────────────────────────────────────
  let storeId;

  if (stores.length === 1) {
    // Auto-select if only one store
    storeId = stores[0].id;
    p.note(`${stores[0].name} (ID: ${storeId})`, "Tienda seleccionada");
  } else {
    const selectedId = await p.select({
      message: "Seleccioná una tienda",
      options: stores.map((store) => ({
        value: store.id,
        label: store.name,
        hint: `ID: ${store.id}`,
      })),
      initialValue: existingConfig?.storeId ?? stores[0].id,
    });

    if (p.isCancel(selectedId)) {
      p.cancel("Inicialización cancelada.");
      process.exit(0);
    }

    storeId = selectedId;
  }

  // ─── Save ─────────────────────────────────────────────────────────────────
  await writeConfig({ storeId, apiBaseUrl });
  await writeCredentials({ apiKey });

  p.note(
    [
      'Ejecutá "tiendu pull" para descargar el tema.',
      "",
      "Nota: habilitá el modo dev en la plataforma Tiendu",
      "(Ajustes > General) para que los datos del preview",
      "se muestren correctamente.",
    ].join("\n"),
    "Próximos pasos",
  );

  p.outro("Configuración guardada en .cli/");
};
