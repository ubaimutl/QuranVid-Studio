import { serverConfig } from './config';
import { createApp } from './app';

try { process.loadEnvFile('.env'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
const config = serverConfig();
const { app } = await createApp(config);
const server = app.listen(config.port, config.host, () => console.log(`QuranVid server: ${config.publicUrl.origin}\nMCP endpoint: ${config.publicUrl.origin}/mcp\nCredentials and server files stay outside the static editor.`));
server.requestTimeout = 120000; server.headersTimeout = 20000;
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => { server.close(() => process.exit(0)); setTimeout(() => process.exit(1), 10000).unref(); });
