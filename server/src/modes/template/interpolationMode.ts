import { LanguageMode } from '../../embeddedSupport/languageModes';
import {
  Diagnostic,
  TextDocument,
  DiagnosticSeverity,
  Position,
  MarkedString,
  Range,
  Location,
  Definition,
  CompletionList,
  TextEdit,
  CompletionItem
} from 'vscode-languageserver-types';
import { IServiceHost } from '../../services/typescriptService/serviceHost';
import { languageServiceIncludesFile } from '../script/javascript';
import { getFileFsPath, resolveUriAndPaths } from '../../utils/paths';
import { mapBackRange, mapFromPositionToOffset } from '../../services/typescriptService/sourceMap';
import * as ts from 'typescript';
import { T_TypeScript } from '../../services/dependencyService';
import * as _ from 'lodash';
import { createTemplateDiagnosticFilter } from '../../services/typescriptService/templateDiagnosticFilter';
import { NULL_COMPLETION } from '../nullMode';
import { toCompletionItemKind } from '../../services/typescriptService/util';
import { VueInfoService } from '../../services/vueInfoService';
import { LanguageModelCache } from '../../embeddedSupport/languageModelCache';
import { HTMLDocument } from './parser/htmlParser';
import { isInsideInterpolation } from './services/isInsideInterpolation';

export class VueInterpolationMode implements LanguageMode {
  private config: any = {};

  constructor(
    private tsModule: T_TypeScript,
    private serviceHost: IServiceHost,
    private vueDocuments: LanguageModelCache<HTMLDocument>,
    private vueInfoService?: VueInfoService
  ) {}

  getId() {
    return 'vue-html-interpolation';
  }

  configure(c: any) {
    this.config = c;
  }

  queryVirtualFileInfo(fileName: string, currFileText: string) {
    return this.serviceHost.queryVirtualFileInfo(fileName, currFileText);
  }

  doValidation(document: TextDocument): Diagnostic[] {
    if (!this.interpolationEnabled() || !this.documentTypeChecked(document)) {
      return [];
    }

    // Add suffix to process this doc as vue template.
    const templateDoc = TextDocument.create(
      document.uri + '.template',
      document.languageId,
      document.version,
      document.getText()
    );

    const { templateService, templateSourceMap } = this.serviceHost.updateCurrentVirtualVueTextDocument(templateDoc);
    if (!languageServiceIncludesFile(templateService, templateDoc.uri)) {
      return [];
    }

    const templateFileFsPath = getFileFsPath(templateDoc.uri);
    // We don't need syntactic diagnostics because
    // compiled template is always valid JavaScript syntax.
    const rawTemplateDiagnostics = templateService.getSemanticDiagnostics(templateFileFsPath);
    const templateDiagnosticFilter = createTemplateDiagnosticFilter(this.tsModule);

    return rawTemplateDiagnostics.filter(templateDiagnosticFilter).map(diag => {
      // syntactic/semantic diagnostic always has start and length
      // so we can safely cast diag to TextSpan
      return {
        range: mapBackRange(templateDoc, diag as ts.TextSpan, templateSourceMap),
        severity: DiagnosticSeverity.Error,
        message: ts.flattenDiagnosticMessageText(diag.messageText, '\n'),
        code: diag.code,
        source: 'Vetur'
      };
    });
  }

  doComplete(document: TextDocument, position: Position): CompletionList {
    if (!this.interpolationEnabled()) {
      return NULL_COMPLETION;
    }

    const offset = document.offsetAt(position);
    const node = this.vueDocuments.refreshAndGet(document).findNodeBefore(offset);
    const nodeRange = Range.create(document.positionAt(node.start), document.positionAt(node.end));
    const nodeText = document.getText(nodeRange);
    if (!isInsideInterpolation(node, nodeText, offset - node.start)) {
      return NULL_COMPLETION;
    }

    // Add suffix to process this doc as vue template.
    const templateDoc = TextDocument.create(
      document.uri + '.template',
      document.languageId,
      document.version,
      document.getText()
    );

    const { templateService, templateSourceMap } = this.serviceHost.updateCurrentVirtualVueTextDocument(templateDoc);
    if (!languageServiceIncludesFile(templateService, templateDoc.uri)) {
      return NULL_COMPLETION;
    }

    /**
     * In the cases of empty content inside node
     * For example, completion in {{ | }}
     * Source map would only map this position {{|  }}
     * And position mapped back wouldn't fall into any source map ranges
     */
    let completionPos = position;
    // Case {{ }}
    if (node.isInterpolation) {
      if (nodeText.match(/{{\s*}}/)) {
        completionPos = document.positionAt(node.start + '{{'.length);
      }
    }
    // Todo: Case v-, : or @ directives

    const mappedOffset = mapFromPositionToOffset(templateDoc, completionPos, templateSourceMap);
    const templateFileFsPath = getFileFsPath(templateDoc.uri);

    const completions = templateService.getCompletionsAtPosition(templateFileFsPath, mappedOffset, {
      includeCompletionsWithInsertText: true,
      includeCompletionsForModuleExports: false
    });

    if (!completions) {
      return NULL_COMPLETION;
    }

    const tsItems = completions.entries.map((entry, index) => {
      return {
        uri: templateDoc.uri,
        position,
        label: entry.name,
        sortText: entry.name.startsWith('$') ? '1' + entry.sortText : '0' + entry.sortText,
        kind: toCompletionItemKind(entry.kind),
        textEdit:
          entry.replacementSpan &&
          TextEdit.replace(mapBackRange(templateDoc, entry.replacementSpan, templateSourceMap), entry.name),
        data: {
          // data used for resolving item details (see 'doResolve')
          languageId: 'vue-html',
          uri: templateDoc.uri,
          offset: position,
          source: entry.source
        }
      };
    });

    return {
      isIncomplete: false,
      items: tsItems
    };
  }

  doResolve(document: TextDocument, item: CompletionItem): CompletionItem {
    if (!this.interpolationEnabled()) {
      return item;
    }

    /**
     * resolve is called for both HTMl and interpolation completions
     * HTML completions send back no data
     */
    if (!item.data) {
      return item;
    }

    // Add suffix to process this doc as vue template.
    const templateDoc = TextDocument.create(
      document.uri + '.template',
      document.languageId,
      document.version,
      document.getText()
    );

    const { templateService, templateSourceMap } = this.serviceHost.updateCurrentVirtualVueTextDocument(templateDoc);
    if (!languageServiceIncludesFile(templateService, templateDoc.uri)) {
      return item;
    }

    const templateFileFsPath = getFileFsPath(templateDoc.uri);
    const mappedOffset = mapFromPositionToOffset(templateDoc, item.data.offset, templateSourceMap);

    const details = templateService.getCompletionEntryDetails(
      templateFileFsPath,
      mappedOffset,
      item.label,
      undefined,
      undefined,
      undefined
    );

    if (details) {
      item.detail = ts.displayPartsToString(details.displayParts);
      item.documentation = ts.displayPartsToString(details.documentation);
      delete item.data;
    }
    return item;
  }

  doHover(
    document: TextDocument,
    position: Position
  ): {
    contents: MarkedString[];
    range?: Range;
  } {
    if (!this.interpolationEnabled()) {
      return { contents: [] };
    }

    // Add suffix to process this doc as vue template.
    const templateDoc = TextDocument.create(
      document.uri + '.template',
      document.languageId,
      document.version,
      document.getText()
    );

    const { templateService, templateSourceMap } = this.serviceHost.updateCurrentVirtualVueTextDocument(templateDoc);
    if (!languageServiceIncludesFile(templateService, templateDoc.uri)) {
      return {
        contents: []
      };
    }

    const templateFileFsPath = getFileFsPath(templateDoc.uri);
    const mappedPosition = mapFromPositionToOffset(templateDoc, position, templateSourceMap);

    const info = templateService.getQuickInfoAtPosition(templateFileFsPath, mappedPosition);
    if (info) {
      const display = this.tsModule.displayPartsToString(info.displayParts);
      const doc = this.tsModule.displayPartsToString(info.documentation);
      const markedContents: MarkedString[] = [{ language: 'ts', value: display }];
      if (doc) {
        markedContents.unshift(doc, '\n');
      }
      return {
        range: mapBackRange(templateDoc, info.textSpan, templateSourceMap),
        contents: markedContents
      };
    }
    return { contents: [] };
  }

  findDefinition(document: TextDocument, position: Position): Location[] {
    if (!this.interpolationEnabled()) {
      return [];
    }

    // Add suffix to process this doc as vue template.
    const templateDoc = TextDocument.create(
      document.uri + '.template',
      document.languageId,
      document.version,
      document.getText()
    );

    const { templateService, templateSourceMap } = this.serviceHost.updateCurrentVirtualVueTextDocument(templateDoc);
    if (!languageServiceIncludesFile(templateService, templateDoc.uri)) {
      return [];
    }

    const templateFileFsPath = getFileFsPath(templateDoc.uri);
    const mappedPosition = mapFromPositionToOffset(templateDoc, position, templateSourceMap);
    const definitions = templateService.getDefinitionAtPosition(templateFileFsPath, mappedPosition);
    if (!definitions) {
      return [];
    }

    const definitionResults: Definition = [];
    const program = templateService.getProgram();
    if (!program) {
      return [];
    }

    definitions.forEach(r => {
      const definitionTargetDoc = r.fileName === templateFileFsPath ? document : getSourceDoc(r.fileName, program);
      if (definitionTargetDoc) {
        const range =
          r.fileName === templateFileFsPath
            ? mapBackRange(templateDoc, r.textSpan, templateSourceMap)
            : convertRange(definitionTargetDoc, r.textSpan);

        definitionResults.push({
          uri: definitionTargetDoc.uri.toString(),
          range
        });
      }
    });
    return definitionResults;
  }

  findReferences(document: TextDocument, position: Position): Location[] {
    if (!this.interpolationEnabled()) {
      return [];
    }

    // Add suffix to process this doc as vue template.
    const templateDoc = TextDocument.create(
      document.uri + '.template',
      document.languageId,
      document.version,
      document.getText()
    );

    const { templateService, templateSourceMap } = this.serviceHost.updateCurrentVirtualVueTextDocument(templateDoc);
    if (!languageServiceIncludesFile(templateService, templateDoc.uri)) {
      return [];
    }

    const templateFileFsPath = getFileFsPath(templateDoc.uri);
    const mappedPosition = mapFromPositionToOffset(templateDoc, position, templateSourceMap);
    const references = templateService.getReferencesAtPosition(templateFileFsPath, mappedPosition);
    if (!references) {
      return [];
    }

    const referenceResults: Location[] = [];
    const program = templateService.getProgram();
    if (!program) {
      return [];
    }

    references.forEach(r => {
      const referenceTargetDoc = r.fileName === templateFileFsPath ? document : getSourceDoc(r.fileName, program);
      if (referenceTargetDoc) {
        const range =
          r.fileName === templateFileFsPath
            ? mapBackRange(templateDoc, r.textSpan, templateSourceMap)
            : convertRange(referenceTargetDoc, r.textSpan);

        referenceResults.push({
          uri: referenceTargetDoc.uri.toString(),
          range
        });
      }
    });
    return referenceResults;
  }

  onDocumentRemoved() {}

  dispose() {}

  private interpolationEnabled(): boolean {
    return _.get(this.config, ['vetur', 'experimental', 'templateInterpolationService'], true);
  }
  private documentTypeChecked(document: TextDocument): boolean {
    const { updateCurrentVueTextDocument } = this.serviceHost;
    const { service } = updateCurrentVueTextDocument(document);
    const program = service.getProgram();

    // If a component uses an external script, check the type of that file, rather than the component's script region
    const scriptSrc = this.vueInfoService && this.vueInfoService.getImportedScripts(document)[0];
    const scriptUri = scriptSrc ? resolveUriAndPaths(document.uri, '..', scriptSrc) : document.uri;

    if (!languageServiceIncludesFile(service, scriptUri) || !program) {
      return false;
    }

    const fileFsPath = getFileFsPath(scriptUri);
    const sourceFile = program.getSourceFile(fileFsPath);

    // TODO: Raise issue in TS repo, to mark `checkJsDirective` as externally available
    // per discussion on AST viewer: https://github.com/dsherret/ts-ast-viewer/issues/65#issuecomment-605706743
    const checkJsDirective: ts.CheckJsDirective | undefined = (sourceFile as any).checkJsDirective;
    const isCheckJsEnabled = (checkJsDirective && checkJsDirective.enabled) || false;

    // TODO: Raise issue in TS repo, to mark `scriptKind` as externally available
    const isTypeScript = [ts.ScriptKind.TS, ts.ScriptKind.TSX].includes((sourceFile as any).scriptKind);

    return isTypeScript || isCheckJsEnabled;
  }
}

function getSourceDoc(fileName: string, program: ts.Program): TextDocument {
  const sourceFile = program.getSourceFile(fileName)!;
  return TextDocument.create(fileName, 'vue', 0, sourceFile.getFullText());
}

function convertRange(document: TextDocument, span: ts.TextSpan): Range {
  const startPosition = document.positionAt(span.start);
  const endPosition = document.positionAt(span.start + span.length);
  return Range.create(startPosition, endPosition);
}
