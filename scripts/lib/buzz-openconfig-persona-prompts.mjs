import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

// Install a checked-in persona prompt into Buzz's private runtime directory.
// The source stays immutable; the target is replaced atomically with mode 0600.
export async function installPersonaPrompt(role) {
  const contents = await readFile(role.personaSource, "utf8");
  const current = await readFile(role.personaPath, "utf8").catch(() => null);
  if (current === contents) {
    await chmod(role.personaPath, 0o600);
    return contents;
  }

  await mkdir(path.dirname(role.personaPath), { recursive: true, mode: 0o700 });
  const temporary = `${role.personaPath}.${process.pid}.tmp`;
  await writeFile(temporary, contents, { encoding: "utf8", mode: 0o600 });
  try {
    await rename(temporary, role.personaPath);
    await chmod(role.personaPath, 0o600);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
  return contents;
}
