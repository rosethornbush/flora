import {
  codexAuthFile,
  finishCodexLogin,
  saveCodexCredentials,
  startCodexLogin,
} from "./providers/codex";
const session = await startCodexLogin();
console.log(`Authorize Flora: ${session.verificationURL}\nDevice code: ${session.userCode}`);
const credentials = await finishCodexLogin(session, AbortSignal.timeout(900_000));
await saveCodexCredentials(codexAuthFile, credentials);
console.log(`Codex connected. Credentials saved to ${codexAuthFile}. Restart Flora to load them.`);
