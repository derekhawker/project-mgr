export function registerXtGetTcapHandler(terminal, writeToPty) {
  return terminal.parser.registerDcsHandler({ intermediates: '+', final: 'q' }, (data) => {
    const capabilities = data.split(';').filter((capability) => /^[0-9a-f]+$/i.test(capability));
    if (capabilities.length === 0) return false;

    const response = capabilities.map((capability) => `\x1bP0+r${capability}\x1b\\`).join('');
    writeToPty(response);
    return true;
  });
}
