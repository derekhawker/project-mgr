export function CommandResult({ message }) {
  return (
    <>
      <p class="response-label">Startup command response</p>
      <p id="command-result" class="command-result">
        {message()}
      </p>
    </>
  );
}
