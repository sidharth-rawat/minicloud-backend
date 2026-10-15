import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const DEFAULT_TIMEOUT = 60_000;
const MAX_BUFFER = 10 * 1024 * 1024; // 10 MB of captured output

export interface RunResult {
    stdout: string;
    stderr: string;
}

export interface RunOptions {
    cwd?: string;
    timeout?: number;
    env?: NodeJS.ProcessEnv;
}

/**
 * Runs an external command safely.
 *
 * Uses execFile with an explicit argument array — the arguments are passed
 * directly to the OS and are NEVER interpreted by a shell, which removes the
 * command-injection surface of exec(`cmd ${input}`). A timeout is always
 * applied so a hung process cannot stall a deployment forever (execFile
 * kills the process when the timeout elapses).
 */
export async function runCommand(
    file: string,
    args: string[],
    options: RunOptions = {}
): Promise<RunResult> {
    const timeout = options.timeout ?? DEFAULT_TIMEOUT;

    try {
        const { stdout, stderr } = await execFileAsync(file, args, {
            cwd: options.cwd,
            timeout,
            maxBuffer: MAX_BUFFER,
            windowsHide: true,
            env: options.env ? { ...process.env, ...options.env } : process.env
        });

        return { stdout: stdout.toString(), stderr: stderr.toString() };
    } catch (err) {
        const e = err as NodeJS.ErrnoException & {
            stderr?: string | Buffer;
            killed?: boolean;
            signal?: string;
        };

        if (e.killed && e.signal) {
            throw new Error(`Command "${file}" timed out after ${timeout}ms`);
        }

        // Keep only the tail of stderr so logs stay readable and bounded.
        const detail = (e.stderr?.toString() || e.message || "").trim().slice(-500);
        throw new Error(`Command "${file} ${args.join(" ")}" failed: ${detail}`);
    }
}
