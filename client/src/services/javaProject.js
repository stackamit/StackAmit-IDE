/**
 * Java project shape detection for the desktop language server.
 *
 * Why this exists: JDT.LS behaves differently for a file inside a Maven/Gradle
 * project (it imports the build descriptor and resolves third-party libraries
 * from the local cache) and for a standalone `.java` file (it compiles against
 * the JDK platform only). Telling the server the wrong thing is not harmless —
 * treating a real project as standalone silently disables dependency
 * resolution, which looks exactly like "my libraries are reported as errors".
 * So the answer is derived from the folders the file actually lives in, and any
 * doubt resolves to 'project'.
 */
import { workspace } from './workspace.js';

/** Build descriptors that make a Java file part of a real Maven/Gradle project. */
export const JAVA_PROJECT_MARKERS = ['pom.xml', 'build.gradle', 'build.gradle.kts', 'settings.gradle', 'settings.gradle.kts'];

/** True when a file name/path is one of the Java build descriptors. */
export function isJavaProjectMarker(name = '') {
  const base = String(name).split(/[\\/]/).pop().toLowerCase();
  return JAVA_PROJECT_MARKERS.some((m) => m.toLowerCase() === base);
}

/**
 * 'standalone' is only returned when every folder from the file up to the
 * workspace root was read successfully and holds no build descriptor. Any
 * listing failure answers 'project': treating a real Maven/Gradle project as
 * standalone silently turns dependency import off, which is the failure the
 * user reports as "my libraries are flagged as errors".
 */
export async function detectJavaProjectMode(docPath, root) {
  const dirs = [];
  const trim = (p) => String(p || '').replace(/[\\/]+$/, '');
  const parentOf = (p) => {
    const s = trim(p);
    const i = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'));
    return i > 0 ? s.slice(0, i) : '';
  };
  const rootDir = trim(root);
  let cur = parentOf(docPath);
  for (let depth = 0; depth < 10 && cur; depth++) {
    dirs.push(cur);
    if (cur.toLowerCase() === rootDir.toLowerCase()) break;
    const up = parentOf(cur);
    if (!up || up === cur) break;
    cur = up;
  }
  if (rootDir && !dirs.some((d) => d.toLowerCase() === rootDir.toLowerCase())) dirs.unshift(rootDir);
  if (!dirs.length) return 'standalone';
  for (const dir of dirs) {
    let res;
    try {
      res = await workspace.readDirectory(dir);
    } catch {
      return 'project'; // doubt: keep dependency import on
    }
    if (!res?.ok) return 'project';
    const names = (res.entries || [])
      .filter((e) => !e.isDirectory)
      .map((e) => String(e.name || e.path || '').split(/[\\/]/).pop().toLowerCase());
    if (names.some((n) => JAVA_PROJECT_MARKERS.some((m) => m.toLowerCase() === n))) return 'project';
  }
  return 'standalone';
}
