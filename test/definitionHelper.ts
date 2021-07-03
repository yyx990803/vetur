import assert from 'assert';
import vscode from 'vscode';
import { showFile } from './editorHelper';

export async function testDefinition(docUri: vscode.Uri, position: vscode.Position, expectedLocation: vscode.Location) {
  await showFile(docUri);

  const result = (await vscode.commands.executeCommand(
    'vscode.executeDefinitionProvider',
    docUri,
    position
  )) as vscode.Location[];

  assert.deepStrictEqual(result[0].range, expectedLocation.range);
  assert.strictEqual(result[0].uri.fsPath, expectedLocation.uri.fsPath);
}
