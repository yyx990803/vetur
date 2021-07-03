import _ from 'lodash';

import { LanguageModelCache, getLanguageModelCache } from '../../embeddedSupport/languageModelCache';
import { Position, Range, FormattingOptions, CompletionItem } from 'vscode-languageserver-types';
import type { TextDocument } from 'vscode-languageserver-textdocument';
import { LanguageMode } from '../../embeddedSupport/languageModes';
import { VueDocumentRegions } from '../../embeddedSupport/embeddedSupport';
import { HTMLDocument } from './parser/htmlParser';
import { doComplete } from './services/htmlCompletion';
import { doHover } from './services/htmlHover';
import { findDocumentHighlights } from './services/htmlHighlighting';
import { findDocumentLinks } from './services/htmlLinks';
import { findDocumentSymbols } from './services/htmlSymbolsProvider';
import { htmlFormat } from './services/htmlFormat';
import { doESLintValidation, createLintEngine } from './services/htmlEslintValidation';
import { findDefinition } from './services/htmlDefinition';
import {
  getTagProviderSettings,
  IHTMLTagProvider,
  CompletionConfiguration,
  getEnabledTagProviders
} from './tagProviders';
import { DocumentContext } from '../../types';
import { VLSFormatConfig, VLSFullConfig } from '../../config';
import { VueInfoService } from '../../services/vueInfoService';
import { getComponentInfoTagProvider } from './tagProviders/componentInfoTagProvider';
import { doPropValidation } from './services/vuePropValidation';
import { getFoldingRanges } from './services/htmlFolding';
import { DependencyService } from '../../services/dependencyService';
import { isVCancellationRequested, VCancellationToken } from '../../utils/cancellationToken';
import { AutoImportSfcPlugin } from '../plugins/autoImportSfcPlugin';
import { EnvironmentService } from '../../services/EnvironmentService';
import { DocumentService } from '../../services/documentService';

export class HTMLMode implements LanguageMode {
  private tagProviderSettings: CompletionConfiguration;
  private enabledTagProviders: IHTMLTagProvider[];
  private embeddedDocuments: LanguageModelCache<TextDocument>;
  private lintEngine: any;

  constructor(
    documentRegions: LanguageModelCache<VueDocumentRegions>,
    private env: EnvironmentService,
    private dependencyService: DependencyService,
    private vueDocuments: LanguageModelCache<HTMLDocument>,
    private autoImportSfcPlugin: AutoImportSfcPlugin,
    private vueInfoService?: VueInfoService
  ) {
    this.tagProviderSettings = getTagProviderSettings(env.getPackagePath());
    this.enabledTagProviders = getEnabledTagProviders(this.tagProviderSettings);
    this.embeddedDocuments = getLanguageModelCache<TextDocument>(10, 60, document =>
      documentRegions.refreshAndGet(document).getSingleLanguageDocument('vue-html')
    );
    this.lintEngine = createLintEngine(env.getVueVersion());
  }

  getId() {
    return 'html';
  }

  async doValidation(document: TextDocument, cancellationToken?: VCancellationToken) {
    const diagnostics = [];

    if (await isVCancellationRequested(cancellationToken)) {
      return [];
    }
    if (this.env.getConfig().vetur.validation.templateProps) {
      const info = this.vueInfoService ? this.vueInfoService.getInfo(document) : undefined;
      const version = this.env.getVueVersion();
      if (info && info.componentInfo.childComponents) {
        diagnostics.push(...doPropValidation(document, this.vueDocuments.refreshAndGet(document), info, version));
      }
    }

    if (await isVCancellationRequested(cancellationToken)) {
      return diagnostics;
    }
    if (this.env.getConfig().vetur.validation.template) {
      const embedded = this.embeddedDocuments.refreshAndGet(document);
      diagnostics.push(...(await doESLintValidation(embedded, this.lintEngine)));
    }

    return diagnostics;
  }
  doComplete(document: TextDocument, position: Position) {
    const embedded = this.embeddedDocuments.refreshAndGet(document);
    const tagProviders: IHTMLTagProvider[] = [...this.enabledTagProviders];

    const info = this.vueInfoService ? this.vueInfoService.getInfo(document) : undefined;
    if (info && info.componentInfo.childComponents) {
      tagProviders.push(getComponentInfoTagProvider(info.componentInfo.childComponents));
    }

    return doComplete(
      embedded,
      position,
      this.vueDocuments.refreshAndGet(embedded),
      tagProviders,
      this.env.getConfig().emmet,
      this.autoImportSfcPlugin.doComplete(document)
    );
  }
  doHover(document: TextDocument, position: Position) {
    const embedded = this.embeddedDocuments.refreshAndGet(document);
    const tagProviders: IHTMLTagProvider[] = [...this.enabledTagProviders];

    const info = this.vueInfoService ? this.vueInfoService.getInfo(document) : undefined;
    if (info && info.componentInfo.childComponents) {
      tagProviders.push(getComponentInfoTagProvider(info.componentInfo.childComponents));
    }

    return doHover(embedded, position, this.vueDocuments.refreshAndGet(embedded), tagProviders);
  }
  findDocumentHighlight(document: TextDocument, position: Position) {
    return findDocumentHighlights(document, position, this.vueDocuments.refreshAndGet(document));
  }
  findDocumentLinks(document: TextDocument, documentContext: DocumentContext) {
    return findDocumentLinks(document, documentContext);
  }
  findDocumentSymbols(document: TextDocument) {
    return findDocumentSymbols(document, this.vueDocuments.refreshAndGet(document));
  }
  format(document: TextDocument, range: Range, formattingOptions: FormattingOptions) {
    return htmlFormat(this.dependencyService, document, range, this.env.getConfig().vetur.format as VLSFormatConfig);
  }
  findDefinition(document: TextDocument, position: Position, documentService: DocumentService) {
    const embedded = this.embeddedDocuments.refreshAndGet(document);
    const info = this.vueInfoService ? this.vueInfoService.getInfo(document) : undefined;
    return findDefinition(embedded, position, this.vueDocuments.refreshAndGet(embedded), documentService, info);
  }
  getFoldingRanges(document: TextDocument) {
    const embedded = this.embeddedDocuments.refreshAndGet(document);
    return getFoldingRanges(embedded);
  }
  onDocumentChanged(filePath: string) {
    if (filePath !== this.env.getPackagePath()) {
      return;
    }

    // reload package
    this.tagProviderSettings = getTagProviderSettings(this.env.getPackagePath());
    this.enabledTagProviders = getEnabledTagProviders(this.tagProviderSettings);
    this.lintEngine = createLintEngine(this.env.getVueVersion());
  }
  onDocumentRemoved(document: TextDocument) {
    this.vueDocuments.onDocumentRemoved(document);
  }
  dispose() {
    this.vueDocuments.dispose();
  }
}
