import { createConnection, InitializeParams, InitializeResult } from 'vscode-languageserver';
import { VLS } from './services/vls';

const connection = process.argv.length <= 2 ? createConnection(process.stdin, process.stdout) : createConnection();

console.log = connection.console.log.bind(connection.console);
console.error = connection.console.error.bind(connection.console);

const vls = new VLS(connection);
connection.onInitialize(
  async (params: InitializeParams): Promise<InitializeResult> => {
    await vls.init(params);

    console.log(`Vetur initialized for workspace folder: ${params.rootPath}`);

    return {
      capabilities: vls.capabilities
    };
  }
);

vls.listen();
