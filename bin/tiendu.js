#!/usr/bin/env node

import { init } from "../lib/init.mjs";
import { pull } from "../lib/pull.mjs";
import { push } from "../lib/push.mjs";
import { dev } from "../lib/dev.mjs";
import { publish } from "../lib/publish.mjs";
import {
  previewCreate,
  previewList,
  previewDelete,
  previewOpen,
} from "../lib/preview.mjs";
import { checkForUpdates } from "../lib/update-check.mjs";

const HELP = `
tiendu — CLI para desarrollar temas de Tiendu

Uso:
  tiendu init                Inicializar un tema en el directorio actual
  tiendu pull                Descargar el tema live desde Tiendu
  tiendu push                Subir archivos locales al preview activo (ZIP)
  tiendu dev                 Modo desarrollo: watch + sync automático
  tiendu publish             Publicar el preview activo al storefront live

  tiendu preview create      Crear un preview remoto
  tiendu preview list        Listar previews de la tienda
  tiendu preview delete      Eliminar el preview activo
  tiendu preview open        Abrir la URL del preview en el navegador

  tiendu help                Mostrar esta ayuda

Opciones:
  --help, -h                 Mostrar esta ayuda
`;

const main = async () => {
  const args = process.argv.slice(2);
  const command = args[0];
  const subcommand = args[1];

  // Check for updates at most once per day (never blocks or throws)
  await checkForUpdates();

  if (
    !command ||
    command === "help" ||
    command === "--help" ||
    command === "-h"
  ) {
    console.log(HELP.trim());
    process.exit(0);
  }

  if (command === "init") {
    await init();
    return;
  }

  if (command === "pull") {
    await pull();
    return;
  }

  if (command === "push") {
    await push();
    return;
  }

  if (command === "dev") {
    await dev();
    return;
  }

  if (command === "publish") {
    await publish();
    return;
  }

  if (command === "preview") {
    if (subcommand === "create") {
      const name = args[2];
      await previewCreate(name);
      return;
    }

    if (subcommand === "list") {
      await previewList();
      return;
    }

    if (subcommand === "delete") {
      await previewDelete();
      return;
    }

    if (subcommand === "open") {
      await previewOpen();
      return;
    }

    console.error(`Subcomando desconocido: preview ${subcommand ?? "(vacío)"}`);
    console.log(HELP.trim());
    process.exit(1);
  }

  console.error(`Comando desconocido: ${command}`);
  console.log(HELP.trim());
  process.exit(1);
};

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
