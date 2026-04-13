import * as p from "@clack/prompts";

let forcedNonInteractive = false;

const canUseInteractiveUi = () =>
  !forcedNonInteractive && Boolean(process.stdin.isTTY) && Boolean(process.stdout.isTTY);

const writePlain = (message, { error = false } = {}) => {
  const text = String(message ?? "");
  if (error) {
    console.error(text);
    return;
  }
  console.log(text);
};

export const configureUi = ({ nonInteractive = false } = {}) => {
  forcedNonInteractive = nonInteractive;
};

export const isInteractive = () => canUseInteractiveUi();

export const intro = (message) => {
  if (canUseInteractiveUi()) {
    p.intro(message);
    return;
  }
  writePlain(message);
};

export const outro = (message) => {
  if (canUseInteractiveUi()) {
    p.outro(message);
    return;
  }
  writePlain(message);
};

export const cancel = (message) => {
  if (canUseInteractiveUi()) {
    p.cancel(message);
    return;
  }
  writePlain(message, { error: true });
};

export const note = (message, title) => {
  if (canUseInteractiveUi()) {
    p.note(message, title);
    return;
  }

  if (title) writePlain(`${title}:`);
  for (const line of String(message ?? "").split("\n")) {
    writePlain(line);
  }
};

export const log = {
  info(message) {
    if (canUseInteractiveUi()) return p.log.info(message);
    writePlain(message);
  },
  warn(message) {
    if (canUseInteractiveUi()) return p.log.warn(message);
    writePlain(message, { error: true });
  },
  error(message) {
    if (canUseInteractiveUi()) return p.log.error(message);
    writePlain(message, { error: true });
  },
  success(message) {
    if (canUseInteractiveUi()) return p.log.success(message);
    writePlain(message);
  },
  message(message) {
    if (canUseInteractiveUi()) return p.log.message(message);
    writePlain(message);
  },
};

export const spinner = () => {
  if (canUseInteractiveUi()) {
    return p.spinner();
  }

  let lastMessage = "";
  return {
    start(message) {
      lastMessage = message ?? "";
      if (lastMessage) writePlain(lastMessage);
    },
    message(message) {
      if (!message || message === lastMessage) return;
      lastMessage = message;
      writePlain(message);
    },
    stop(message, code = 0) {
      const finalMessage = message ?? lastMessage;
      if (!finalMessage) return;
      writePlain(finalMessage, { error: code !== 0 });
    },
  };
};

export const confirm = async (options) => {
  if (canUseInteractiveUi()) {
    return p.confirm(options);
  }
  return true;
};

const failForPrompt = (message) => {
  throw new Error(message);
};

export const select = async (options) => {
  if (canUseInteractiveUi()) {
    return p.select(options);
  }
  return failForPrompt(`Cannot prompt for selection in non-interactive mode: ${options.message}`);
};

export const text = async (options) => {
  if (canUseInteractiveUi()) {
    return p.text(options);
  }
  return failForPrompt(`Cannot prompt for text input in non-interactive mode: ${options.message}`);
};

export const password = async (options) => {
  if (canUseInteractiveUi()) {
    return p.password(options);
  }
  return failForPrompt(`Cannot prompt for password input in non-interactive mode: ${options.message}`);
};

export const isCancel = p.isCancel;
