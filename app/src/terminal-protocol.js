// OpenCode asks XTGETTCAP using '+' as a DCS intermediate (not a prefix).
export function registerXtGetTcapHandler(terminal, writeToPty) {
  return terminal.parser.registerDcsHandler({ intermediates: '+', final: 'q' }, (data) => {
    const capabilities = data.split(';').filter((capability) => /^[0-9a-f]+$/i.test(capability));
    if (!capabilities.length) return false;
    writeToPty(capabilities.map((capability) => `\x1bP0+r${capability}\x1b\\`).join(''));
    return true;
  });
}
