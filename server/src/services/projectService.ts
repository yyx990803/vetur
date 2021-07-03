import path from 'path';
import {
  CodeAction,
  CodeActionParams,
  ColorInformation,
  ColorPresentation,
  ColorPresentationParams,
  CompletionItem,
  CompletionList,
  CompletionParams,
  CompletionTriggerKind,
  Definition,
  Diagnostic,
  DocumentColorParams,
  DocumentFormattingParams,
  DocumentHighlight,
  DocumentLink,
  DocumentLinkParams,
  DocumentSymbolParams,
  FileRename,
  FoldingRange,
  FoldingRangeParams,
  Hover,
  Location,
  SemanticTokens,
  SemanticTokensBuilder,
  SemanticTokensParams,
  SemanticTokensRangeParams,
  SignatureHelp,
  SymbolInformation,
  TextDocumentEdit,
  TextDocumentPositionParams,
  TextEdit
} from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { URI } from 'vscode-uri';
import { LanguageId } from '../embeddedSupport/embeddedSupport';
import { LanguageMode, LanguageModes } from '../embeddedSupport/languageModes';
import { NULL_COMPLETION, NULL_HOVER, NULL_SIGNATURE } from '../modes/nullMode';
import { DocumentContext, CodeActionData, SemanticTokenData } from '../types';
import { VCancellationToken } from '../utils/cancellationToken';
import { getFileFsPath } from '../utils/paths';
import { DependencyService } from './dependencyService';
import { DocumentService } from './documentService';
import { EnvironmentService } from './EnvironmentService';
import { RefTokensService } from './RefTokenService';
import { VueInfoService } from './vueInfoService';

export interface ProjectService {
  env: EnvironmentService;
  languageModes: LanguageModes;
  onDocumentFormatting(params: DocumentFormattingParams): Promise<TextEdit[]>;
  onCompletion(params: CompletionParams): Promise<CompletionList>;
  onCompletionResolve(item: CompletionItem): Promise<CompletionItem>;
  onHover(params: TextDocumentPositionParams): Promise<Hover>;
  onDocumentHighlight(params: TextDocumentPositionParams): Promise<DocumentHighlight[]>;
  onDefinition(params: TextDocumentPositionParams): Promise<Definition>;
  onReferences(params: TextDocumentPositionParams): Promise<Location[]>;
  onDocumentLinks(params: DocumentLinkParams): Promise<DocumentLink[]>;
  onDocumentSymbol(params: DocumentSymbolParams): Promise<SymbolInformation[]>;
  onDocumentColors(params: DocumentColorParams): Promise<ColorInformation[]>;
  onColorPresentations(params: ColorPresentationParams): Promise<ColorPresentation[]>;
  onSignatureHelp(params: TextDocumentPositionParams): Promise<SignatureHelp | null>;
  onFoldingRanges(params: FoldingRangeParams): Promise<FoldingRange[]>;
  onCodeAction(params: CodeActionParams): Promise<CodeAction[]>;
  onCodeActionResolve(action: CodeAction): Promise<CodeAction>;
  onWillRenameFile(fileRename: FileRename): Promise<TextDocumentEdit[]>;
  onSemanticTokens(params: SemanticTokensParams | SemanticTokensRangeParams): Promise<SemanticTokens>;
  doValidate(doc: TextDocument, cancellationToken?: VCancellationToken): Promise<Diagnostic[] | null>;
  dispose(): Promise<void>;
}

export async function createProjectService(
  env: EnvironmentService,
  documentService: DocumentService,
  globalSnippetDir: string | undefined,
  dependencyService: DependencyService,
  refTokensService: RefTokensService
): Promise<ProjectService> {
  const vueInfoService = new VueInfoService();
  const languageModes = new LanguageModes();

  function getValidationFlags(): Record<string, boolean> {
    const config = env.getConfig();
    return {
      'vue-html': config.vetur.validation.template || config.vetur.validation.templateProps,
      css: config.vetur.validation.style,
      postcss: config.vetur.validation.style,
      scss: config.vetur.validation.style,
      less: config.vetur.validation.style,
      javascript: config.vetur.validation.script
    };
  }

  vueInfoService.init(languageModes);
  await languageModes.init(
    env,
    {
      infoService: vueInfoService,
      dependencyService,
      refTokensService,
      documentService
    },
    globalSnippetDir
  );

  return {
    env,
    languageModes,
    async onDocumentFormatting({ textDocument, options }) {
      if (!env.getConfig().vetur.format.enable) {
        return [];
      }

      const doc = documentService.getDocument(textDocument.uri)!;

      const modeRanges = languageModes.getAllLanguageModeRangesInDocument(doc);
      const allEdits: TextEdit[] = [];

      const errMessages: string[] = [];

      modeRanges.forEach(modeRange => {
        if (modeRange.mode && modeRange.mode.format) {
          try {
            const edits = modeRange.mode.format(doc, { start: modeRange.start, end: modeRange.end }, options);
            for (const edit of edits) {
              allEdits.push(edit);
            }
          } catch (err) {
            errMessages.push(err.toString());
          }
        }
      });

      if (errMessages.length !== 0) {
        console.error('Formatting failed: "' + errMessages.join('\n') + '"');
        return [];
      }

      return allEdits;
    },
    async onCompletion({ textDocument, position, context }) {
      const doc = documentService.getDocument(textDocument.uri)!;
      const mode = languageModes.getModeAtPosition(doc, position);
      if (mode && mode.doComplete) {
        /**
         * Only use space as trigger character in `vue-html` mode
         */
        if (
          mode.getId() !== 'vue-html' &&
          context &&
          context?.triggerKind === CompletionTriggerKind.TriggerCharacter &&
          context.triggerCharacter === ' '
        ) {
          return NULL_COMPLETION;
        }

        return mode.doComplete(doc, position);
      }

      return NULL_COMPLETION;
    },
    async onCompletionResolve(item) {
      if (item.data) {
        const uri: string = item.data.uri;
        const languageId: LanguageId = item.data.languageId;

        /**
         * Template files need to go through HTML-template service
         */
        if (uri.endsWith('.template')) {
          const doc = documentService.getDocument(uri.slice(0, -'.template'.length));
          const mode = languageModes.getMode(languageId);
          if (doc && mode && mode.doResolve) {
            return mode.doResolve(doc, item);
          }
        }

        if (uri && languageId) {
          const doc = documentService.getDocument(uri);
          const mode = languageModes.getMode(languageId);
          if (doc && mode && mode.doResolve) {
            return mode.doResolve(doc, item);
          }
        }
      }

      return item;
    },
    async onHover({ textDocument, position }) {
      const doc = documentService.getDocument(textDocument.uri)!;
      const mode = languageModes.getModeAtPosition(doc, position);
      if (mode && mode.doHover) {
        return mode.doHover(doc, position);
      }
      return NULL_HOVER;
    },
    async onDocumentHighlight({ textDocument, position }) {
      const doc = documentService.getDocument(textDocument.uri)!;
      const mode = languageModes.getModeAtPosition(doc, position);
      if (mode && mode.findDocumentHighlight) {
        return mode.findDocumentHighlight(doc, position);
      }
      return [];
    },
    async onDefinition({ textDocument, position }) {
      const doc = documentService.getDocument(textDocument.uri)!;
      const mode = languageModes.getModeAtPosition(doc, position);
      if (mode && mode.findDefinition) {
        return mode.findDefinition(doc, position, documentService);
      }
      return [];
    },
    async onReferences({ textDocument, position }) {
      const doc = documentService.getDocument(textDocument.uri)!;
      const mode = languageModes.getModeAtPosition(doc, position);
      if (mode && mode.findReferences) {
        return mode.findReferences(doc, position);
      }
      return [];
    },
    async onDocumentLinks({ textDocument }) {
      const doc = documentService.getDocument(textDocument.uri)!;
      const documentContext: DocumentContext = {
        resolveReference: ref => {
          if (ref[0] === '/') {
            return URI.file(path.resolve(env.getProjectRoot(), ref)).toString();
          }
          const fsPath = getFileFsPath(doc.uri);
          return URI.file(path.resolve(fsPath, '..', ref)).toString();
        }
      };

      const links: DocumentLink[] = [];
      languageModes.getAllLanguageModeRangesInDocument(doc).forEach(m => {
        if (m.mode.findDocumentLinks) {
          links.push.apply(links, m.mode.findDocumentLinks(doc, documentContext));
        }
      });
      return links;
    },
    async onDocumentSymbol({ textDocument }) {
      const doc = documentService.getDocument(textDocument.uri)!;
      const symbols: SymbolInformation[] = [];

      languageModes.getAllLanguageModeRangesInDocument(doc).forEach(m => {
        if (m.mode.findDocumentSymbols) {
          symbols.push.apply(symbols, m.mode.findDocumentSymbols(doc));
        }
      });
      return symbols;
    },
    async onDocumentColors({ textDocument }) {
      const doc = documentService.getDocument(textDocument.uri)!;
      const colors: ColorInformation[] = [];

      const distinctModes: Set<LanguageMode> = new Set();
      languageModes.getAllLanguageModeRangesInDocument(doc).forEach(m => {
        distinctModes.add(m.mode);
      });

      for (const mode of distinctModes) {
        if (mode.findDocumentColors) {
          colors.push.apply(colors, mode.findDocumentColors(doc));
        }
      }

      return colors;
    },
    async onColorPresentations({ textDocument, color, range }) {
      const doc = documentService.getDocument(textDocument.uri)!;
      const mode = languageModes.getModeAtPosition(doc, range.start);
      if (mode && mode.getColorPresentations) {
        return mode.getColorPresentations(doc, color, range);
      }
      return [];
    },
    async onSignatureHelp({ textDocument, position }) {
      const doc = documentService.getDocument(textDocument.uri)!;
      const mode = languageModes.getModeAtPosition(doc, position);
      if (mode && mode.doSignatureHelp) {
        return mode.doSignatureHelp(doc, position);
      }
      return NULL_SIGNATURE;
    },
    async onFoldingRanges({ textDocument }) {
      const doc = documentService.getDocument(textDocument.uri)!;
      const lmrs = languageModes.getAllLanguageModeRangesInDocument(doc);

      const result: FoldingRange[] = [];

      lmrs.forEach(lmr => {
        if (lmr.mode.getFoldingRanges) {
          lmr.mode.getFoldingRanges(doc).forEach(r => result.push(r));
        }

        result.push({
          startLine: lmr.start.line,
          startCharacter: lmr.start.character,
          endLine: lmr.end.line,
          endCharacter: lmr.end.character
        });
      });

      return result;
    },
    async onCodeAction({ textDocument, range, context }: CodeActionParams) {
      if (!env.getConfig().vetur.languageFeatures.codeActions) {
        return [];
      }

      const doc = documentService.getDocument(textDocument.uri)!;
      const mode = languageModes.getModeAtPosition(doc, range.start);
      if (languageModes.getModeAtPosition(doc, range.end) !== mode) {
        return [];
      }
      if (mode && mode.getCodeActions) {
        return mode.getCodeActions(doc, range, /*formatParams*/ {} as any, context);
      }
      return [];
    },
    async onCodeActionResolve(action) {
      const data = action.data as CodeActionData | undefined;
      if (data) {
        const uri: string = data.uri;
        const languageId: LanguageId = data.languageId;

        if (uri && languageId) {
          const doc = documentService.getDocument(uri);
          const mode = languageModes.getMode(languageId);
          if (doc && mode && mode.doCodeActionResolve) {
            return mode.doCodeActionResolve(doc, action);
          }
        }
      }

      return action;
    },
    async onWillRenameFile(fileRename: FileRename) {
      if (!env.getConfig().vetur.languageFeatures.updateImportOnFileMove) {
        return [];
      }

      const textDocumentEdit = languageModes.getMode('typescript')?.getRenameFileEdit?.(fileRename);

      return textDocumentEdit ?? [];
    },
    async onSemanticTokens(params: SemanticTokensParams | SemanticTokensRangeParams) {
      if (!env.getConfig().vetur.languageFeatures.semanticTokens) {
        return {
          data: []
        };
      }

      const { textDocument } = params;
      const range = 'range' in params ? params.range : undefined;
      const doc = documentService.getDocument(textDocument.uri)!;
      const modes = languageModes.getAllLanguageModeRangesInDocument(doc);
      const data: SemanticTokenData[] = [];

      for (const mode of modes) {
        const tokenData = mode.mode.getSemanticTokens?.(doc, range);

        data.push(...(tokenData ?? []));
      }

      const builder = new SemanticTokensBuilder();
      const sorted = data.sort((a, b) => {
        return a.line - b.line || a.character - b.character;
      });
      sorted.forEach(token =>
        builder.push(token.line, token.character, token.length, token.classificationType, token.modifierSet)
      );

      return builder.build();
    },
    async doValidate(doc: TextDocument, cancellationToken?: VCancellationToken) {
      const diagnostics: Diagnostic[] = [];
      if (doc.languageId === 'vue') {
        const validationFlags = getValidationFlags();
        for (const lmr of languageModes.getAllLanguageModeRangesInDocument(doc)) {
          if (lmr.mode.doValidation) {
            if (validationFlags[lmr.mode.getId()]) {
              diagnostics.push.apply(diagnostics, await lmr.mode.doValidation(doc, cancellationToken));
            }
            // Special case for template type checking
            else if (
              lmr.mode.getId() === 'vue-html' &&
              env.getConfig().vetur.experimental.templateInterpolationService
            ) {
              diagnostics.push.apply(diagnostics, await lmr.mode.doValidation(doc, cancellationToken));
            }
          }
        }
      }
      if (cancellationToken?.isCancellationRequested) {
        return null;
      }
      return diagnostics;
    },
    async dispose() {
      languageModes.dispose();
    }
  };
}
