import {
  CompletionItem,
  Location,
  SignatureHelp,
  Definition,
  TextEdit,
  Diagnostic,
  DocumentLink,
  Range,
  Hover,
  DocumentHighlight,
  CompletionList,
  Position,
  FormattingOptions,
  SymbolInformation,
  CodeActionContext,
  ColorInformation,
  Color,
  ColorPresentation,
  CodeAction,
  WorkspaceEdit,
  FoldingRange,
  TextDocumentEdit
} from 'vscode-languageserver-types';
import type { TextDocument } from 'vscode-languageserver-textdocument';

import { getLanguageModelCache, LanguageModelCache } from './languageModelCache';
import { getVueDocumentRegions, VueDocumentRegions, LanguageId, LanguageRange } from './embeddedSupport';
import { getVueMode } from '../modes/vue';
import { getCSSMode, getSCSSMode, getLESSMode, getPostCSSMode } from '../modes/style';
import { getJavascriptMode } from '../modes/script/javascript';
import { VueHTMLMode } from '../modes/template';
import { getStylusMode } from '../modes/style/stylus';
import { DocumentContext, SemanticTokenData } from '../types';
import { VueInfoService } from '../services/vueInfoService';
import { DependencyService } from '../services/dependencyService';
import { nullMode } from '../modes/nullMode';
import { getServiceHost, IServiceHost } from '../services/typescriptService/serviceHost';
import { SassLanguageMode } from '../modes/style/sass/sassLanguageMode';
import { getPugMode } from '../modes/pug';
import { VCancellationToken } from '../utils/cancellationToken';
import { createAutoImportSfcPlugin } from '../modes/plugins/autoImportSfcPlugin';
import { EnvironmentService } from '../services/EnvironmentService';
import { FileRename } from 'vscode-languageserver';
import { RefTokensService } from '../services/RefTokenService';
import { DocumentService } from '../services/documentService';

export interface VLSServices {
  dependencyService: DependencyService;
  infoService: VueInfoService;
  refTokensService: RefTokensService;
  documentService: DocumentService;
}

export interface LanguageMode {
  getId(): string;
  updateFileInfo?(doc: TextDocument): void;

  doValidation?(document: TextDocument, cancellationToken?: VCancellationToken): Promise<Diagnostic[]>;
  getCodeActions?(
    document: TextDocument,
    range: Range,
    formatParams: FormattingOptions,
    context: CodeActionContext
  ): CodeAction[];
  doCodeActionResolve?(document: TextDocument, action: CodeAction): CodeAction;
  doComplete?(document: TextDocument, position: Position): CompletionList;
  doResolve?(document: TextDocument, item: CompletionItem): CompletionItem;
  doHover?(document: TextDocument, position: Position): Hover;
  doSignatureHelp?(document: TextDocument, position: Position): SignatureHelp | null;
  findDocumentHighlight?(document: TextDocument, position: Position): DocumentHighlight[];
  findDocumentSymbols?(document: TextDocument): SymbolInformation[];
  findDocumentLinks?(document: TextDocument, documentContext: DocumentContext): DocumentLink[];
  findDefinition?(document: TextDocument, position: Position, documentService: DocumentService): Definition;
  findReferences?(document: TextDocument, position: Position): Location[];
  format?(document: TextDocument, range: Range, options: FormattingOptions): TextEdit[];
  findDocumentColors?(document: TextDocument): ColorInformation[];
  getColorPresentations?(document: TextDocument, color: Color, range: Range): ColorPresentation[];
  getFoldingRanges?(document: TextDocument): FoldingRange[];
  getRenameFileEdit?(renames: FileRename): TextDocumentEdit[];
  getSemanticTokens?(document: TextDocument, range?: Range): SemanticTokenData[];

  onDocumentChanged?(filePath: string): void;
  onDocumentRemoved(document: TextDocument): void;
  dispose(): void;
}

export interface LanguageModeRange extends LanguageRange {
  mode: LanguageMode;
}

export class LanguageModes {
  private modes: { [k in LanguageId]: LanguageMode } = {
    vue: nullMode,
    pug: nullMode,
    'vue-html': nullMode,
    css: nullMode,
    postcss: nullMode,
    scss: nullMode,
    less: nullMode,
    sass: nullMode,
    stylus: nullMode,
    javascript: nullMode,
    typescript: nullMode,
    tsx: nullMode,
    unknown: nullMode
  };

  private documentRegions: LanguageModelCache<VueDocumentRegions>;
  private modelCaches: LanguageModelCache<any>[];
  private serviceHost: IServiceHost;

  constructor() {
    this.documentRegions = getLanguageModelCache<VueDocumentRegions>(10, 60, document =>
      getVueDocumentRegions(document)
    );

    this.modelCaches = [];
    this.modelCaches.push(this.documentRegions);
  }

  async init(env: EnvironmentService, services: VLSServices, globalSnippetDir?: string) {
    const tsModule = services.dependencyService.get('typescript').module;

    /**
     * Documents where everything outside `<script>` is replaced with whitespace
     */
    const scriptRegionDocuments = getLanguageModelCache(10, 60, document => {
      const vueDocument = this.documentRegions.refreshAndGet(document);
      return vueDocument.getSingleTypeDocument('script');
    });
    this.serviceHost = getServiceHost(tsModule, env, scriptRegionDocuments);
    const autoImportSfcPlugin = createAutoImportSfcPlugin(tsModule, services.infoService);
    autoImportSfcPlugin.setGetTSScriptTarget(() => this.serviceHost.getComplierOptions().target);
    autoImportSfcPlugin.setGetFilesFn(() =>
      this.serviceHost.getFileNames().filter(fileName => fileName.endsWith('.vue'))
    );

    const vueHtmlMode = new VueHTMLMode(
      tsModule,
      this.serviceHost,
      env,
      this.documentRegions,
      autoImportSfcPlugin,
      services.dependencyService,
      services.documentService,
      services.infoService
    );

    const jsMode = await getJavascriptMode(
      this.serviceHost,
      env,
      this.documentRegions,
      services.dependencyService,
      env.getGlobalComponentInfos(),
      services.infoService,
      services.refTokensService
    );
    autoImportSfcPlugin.setGetConfigure(env.getConfig);
    autoImportSfcPlugin.setGetJSResolve(jsMode.doResolve!);

    this.modes['vue'] = getVueMode(env, globalSnippetDir);
    this.modes['vue-html'] = vueHtmlMode;
    this.modes['pug'] = getPugMode(env, services.dependencyService);
    this.modes['css'] = getCSSMode(env, this.documentRegions, services.dependencyService);
    this.modes['postcss'] = getPostCSSMode(env, this.documentRegions, services.dependencyService);
    this.modes['scss'] = getSCSSMode(env, this.documentRegions, services.dependencyService);
    this.modes['sass'] = new SassLanguageMode(env);
    this.modes['less'] = getLESSMode(env, this.documentRegions, services.dependencyService);
    this.modes['stylus'] = getStylusMode(env, this.documentRegions, services.dependencyService);
    this.modes['javascript'] = jsMode;
    this.modes['typescript'] = jsMode;
    this.modes['tsx'] = jsMode;
  }

  getModeAtPosition(document: TextDocument, position: Position): LanguageMode | undefined {
    const languageId = this.documentRegions.refreshAndGet(document).getLanguageAtPosition(position);
    return this.modes?.[languageId];
  }

  getAllLanguageModeRangesInDocument(document: TextDocument): LanguageModeRange[] {
    const result: LanguageModeRange[] = [];

    const documentRegions = this.documentRegions.refreshAndGet(document);

    documentRegions.getAllLanguageRanges().forEach(lr => {
      const mode = this.modes[lr.languageId];
      if (mode) {
        result.push({
          mode,
          ...lr
        });
      }
    });

    return result;
  }

  getAllModes(): LanguageMode[] {
    const result = [];
    for (const languageId in this.modes) {
      const mode = this.modes[<LanguageId>languageId];
      if (mode) {
        result.push(mode);
      }
    }
    return result;
  }

  getMode(languageId: LanguageId): LanguageMode | undefined {
    return this.modes[languageId];
  }

  onDocumentRemoved(document: TextDocument) {
    this.modelCaches.forEach(mc => mc.onDocumentRemoved(document));
    for (const mode in this.modes) {
      this.modes[<LanguageId>mode].onDocumentRemoved(document);
    }
  }

  dispose(): void {
    this.modelCaches.forEach(mc => mc.dispose());
    this.modelCaches = [];
    for (const mode in this.modes) {
      this.modes[<LanguageId>mode].dispose();
    }
    this.serviceHost.dispose();
  }
}
