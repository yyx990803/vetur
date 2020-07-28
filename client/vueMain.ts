import * as vscode from 'vscode';
import { LanguageClient, WorkspaceEdit, WorkspaceFolder } from 'vscode-languageclient';
import { generateGrammarCommandHandler } from './commands/generateGrammarCommand';
import { registerLanguageConfigurations } from './languages';
import { initializeLanguageClient } from './client';
import { join } from 'path';
import {
  setVirtualContents,
  registerVeturTextDocumentProviders,
  generateShowVirtualFileCommand
} from './commands/virtualFileCommand';
import { getGlobalSnippetDir } from './userSnippetDir';
import { generateOpenUserScaffoldSnippetFolderCommand } from './commands/openUserScaffoldSnippetFolderCommand';

/**
 * Map of workspace folder URI -> LanguageClient
 */
const clients = new Map<string, LanguageClient>();

export async function activate(context: vscode.ExtensionContext) {
  const isInsiders = vscode.env.appName.includes('Insiders');
  const globalSnippetDir = getGlobalSnippetDir(isInsiders);

  /**
   * Virtual file display command for debugging template interpolation
   */
  context.subscriptions.push(await registerVeturTextDocumentProviders());

  /**
   * Custom Block Grammar generation command
   */
  context.subscriptions.push(
    vscode.commands.registerCommand('vetur.generateGrammar', generateGrammarCommandHandler(context.extensionPath))
  );

  registerLanguageConfigurations();

  /**
   * Vue Language Server path
   * To be able to work with multiple workspaces, we initialize one language service per workspace folder
   */

  const serverModule = context.asAbsolutePath(join('server', 'dist', 'vueServerMain.js'));

  /**
   * Open custom snippet folder
   */
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'vetur.openUserScaffoldSnippetFolder',
      generateOpenUserScaffoldSnippetFolderCommand(globalSnippetDir)
    )
  );

  function onDidOpenTextDocument(document: vscode.TextDocument) {
    const client = initializeClientForTextDocument(context, serverModule, globalSnippetDir, document);

    // TODO handle commands properly
    if (!client || clients.size > 1) {
      return;
    }

    context.subscriptions.push(
      vscode.commands.registerCommand('vetur.applyWorkspaceEdits', (args: WorkspaceEdit) => {
        const edit = client.protocol2CodeConverter.asWorkspaceEdit(args)!;
        vscode.workspace.applyEdit(edit);
      })
    );

    context.subscriptions.push(
      vscode.commands.registerCommand('vetur.chooseTypeScriptRefactoring', (args: any) => {
        client
          .sendRequest<vscode.Command | undefined>('requestCodeActionEdits', args)
          .then(command => command && vscode.commands.executeCommand(command.command, ...command.arguments!));
      })
    );
  }

  vscode.workspace.onDidOpenTextDocument(onDidOpenTextDocument);
  vscode.workspace.textDocuments.forEach(onDidOpenTextDocument);

  vscode.workspace.onDidChangeWorkspaceFolders(event => {
    for (const folder of event.removed) {
      const client = clients.get(folder.uri.toString());
      if (client) {
        clients.delete(folder.uri.toString());
        client.stop();
      }
    }
  });
}

function initializeClientForTextDocument(
  context: vscode.ExtensionContext,
  serverModule: string,
  globalSnippetDir: string,
  document: vscode.TextDocument
): LanguageClient | undefined {
  const folder = vscode.workspace.getWorkspaceFolder(document.uri);

  if (!folder || document.languageId !== 'vue') {
    return;
  }

  if (!clients.has(folder.uri.toString())) {
    const client = initializeLanguageClient(serverModule, globalSnippetDir, folder);

    client
      .onReady()
      .then(() => {
        registerCustomClientNotificationHandlers(client);
        registerCustomLSPCommands(context, client);
      })
      .catch(e => {
        console.log(`Client initialization failed for workspace: ${folder.uri.toString()}`);
      });

    context.subscriptions.push(client.start());
    clients.set(folder.uri.toString(), client);

    return client;
  }
}

function registerCustomClientNotificationHandlers(client: LanguageClient) {
  client.onNotification('$/displayInfo', (msg: string) => {
    vscode.window.showInformationMessage(msg);
  });
  client.onNotification('$/displayWarning', (msg: string) => {
    vscode.window.showWarningMessage(msg);
  });
  client.onNotification('$/displayError', (msg: string) => {
    vscode.window.showErrorMessage(msg);
  });
  client.onNotification('$/showVirtualFile', (virtualFileSource: string, prettySourceMap: string) => {
    setVirtualContents(virtualFileSource, prettySourceMap);
  });
}

function registerCustomLSPCommands(context: vscode.ExtensionContext, client: LanguageClient) {
  context.subscriptions.push(
    vscode.commands.registerCommand('vetur.showCorrespondingVirtualFile', generateShowVirtualFileCommand(client))
  );
}
