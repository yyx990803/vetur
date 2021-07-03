import { FormattingOptions, Position, Range, Hover, Location, CompletionItem } from 'vscode-languageserver-types';
import type { TextDocument } from 'vscode-languageserver-textdocument';
import { VueDocumentRegions } from '../../embeddedSupport/embeddedSupport';
import { LanguageModelCache, getLanguageModelCache } from '../../embeddedSupport/languageModelCache';
import { LanguageMode } from '../../embeddedSupport/languageModes';
import { VueInfoService } from '../../services/vueInfoService';
import { DocumentContext } from '../../types';
import { HTMLMode } from './htmlMode';
import { VueInterpolationMode } from './interpolationMode';
import { IServiceHost } from '../../services/typescriptService/serviceHost';
import { HTMLDocument, parseHTMLDocument } from './parser/htmlParser';
import { DependencyService, RuntimeLibrary } from '../../services/dependencyService';
import { VCancellationToken } from '../../utils/cancellationToken';
import { AutoImportSfcPlugin } from '../plugins/autoImportSfcPlugin';
import { EnvironmentService } from '../../services/EnvironmentService';
import { DocumentService } from '../../services/documentService';

type DocumentRegionCache = LanguageModelCache<VueDocumentRegions>;

export class VueHTMLMode implements LanguageMode {
  private htmlMode: HTMLMode;
  private vueInterpolationMode: VueInterpolationMode;
  private autoImportSfcPlugin: AutoImportSfcPlugin;
  private documentService: DocumentService;

  constructor(
    tsModule: RuntimeLibrary['typescript'],
    serviceHost: IServiceHost,
    env: EnvironmentService,
    documentRegions: DocumentRegionCache,
    autoImportSfcPlugin: AutoImportSfcPlugin,
    dependencyService: DependencyService,
    documentService: DocumentService,
    vueInfoService?: VueInfoService
  ) {
    const vueDocuments = getLanguageModelCache<HTMLDocument>(10, 60, document => parseHTMLDocument(document));
    this.htmlMode = new HTMLMode(
      documentRegions,
      env,
      dependencyService,
      vueDocuments,
      autoImportSfcPlugin,
      vueInfoService
    );
    this.vueInterpolationMode = new VueInterpolationMode(tsModule, serviceHost, env, vueDocuments, vueInfoService);
    this.autoImportSfcPlugin = autoImportSfcPlugin;
    this.documentService = documentService;
  }
  getId() {
    return 'vue-html';
  }
  queryVirtualFileInfo(fileName: string, currFileText: string) {
    return this.vueInterpolationMode.queryVirtualFileInfo(fileName, currFileText);
  }
  async doValidation(document: TextDocument, cancellationToken?: VCancellationToken) {
    return Promise.all([
      this.vueInterpolationMode.doValidation(document, cancellationToken),
      this.htmlMode.doValidation(document, cancellationToken)
    ]).then(result => [...result[0], ...result[1]]);
  }
  doComplete(document: TextDocument, position: Position) {
    const htmlList = this.htmlMode.doComplete(document, position);
    const intList = this.vueInterpolationMode.doComplete(document, position);
    return {
      isIncomplete: htmlList.isIncomplete || intList.isIncomplete,
      items: htmlList.items.concat(intList.items)
    };
  }
  doResolve(document: TextDocument, item: CompletionItem): CompletionItem {
    if (this.autoImportSfcPlugin.isMyResolve(item)) {
      return this.autoImportSfcPlugin.doResolve(document, item);
    }
    return this.vueInterpolationMode.doResolve(document, item);
  }
  doHover(document: TextDocument, position: Position): Hover {
    // Return concatanated results from both vueInterpolationMode and htmlMode.
    const interpolationHover = this.vueInterpolationMode.doHover(document, position);
    let markdownContent = '';
    if (interpolationHover.contents.length > 0) {
      for (const content of interpolationHover.contents) {
        if (typeof content === 'string') {
          markdownContent += `${content}\n`;
        } else {
          markdownContent += `\`\`\`${content.language}\n${content.value}\n\`\`\`\n`;
        }
      }
    }
    const htmlResult = this.htmlMode.doHover(document, position);
    if (htmlResult.contents && Array.isArray(htmlResult.contents)) {
      for (const content of htmlResult.contents) {
        if (typeof content === 'string') {
          markdownContent += `${content}\n`;
        } else {
          markdownContent += `\`\`\`${content.language}\n${content.value}\n\`\`\`\n`;
        }
      }
    } else if (typeof htmlResult.contents === 'string') {
      markdownContent += `${htmlResult.contents}\n`;
    } else if ('kind' in htmlResult.contents) {
      markdownContent += `${htmlResult.contents.value}\n`;
    } else {
      markdownContent += `\`\`\`${htmlResult.contents.language}\n${htmlResult.contents.value}\n\`\`\`\n`;
    }
    return {
      contents: { kind: 'markdown', value: markdownContent },
      range: interpolationHover.range || htmlResult.range
    };
  }
  findDocumentHighlight(document: TextDocument, position: Position) {
    return this.htmlMode.findDocumentHighlight(document, position);
  }
  findDocumentLinks(document: TextDocument, documentContext: DocumentContext) {
    return this.htmlMode.findDocumentLinks(document, documentContext);
  }
  findDocumentSymbols(document: TextDocument) {
    return this.htmlMode.findDocumentSymbols(document);
  }
  format(document: TextDocument, range: Range, formattingOptions: FormattingOptions) {
    return this.htmlMode.format(document, range, formattingOptions);
  }
  findReferences(document: TextDocument, position: Position): Location[] {
    return this.vueInterpolationMode.findReferences(document, position);
  }
  findDefinition(document: TextDocument, position: Position) {
    const htmlDefinition = this.htmlMode.findDefinition(document, position, this.documentService);

    return htmlDefinition.length > 0 ? htmlDefinition : this.vueInterpolationMode.findDefinition(document, position);
  }
  getFoldingRanges(document: TextDocument) {
    return this.htmlMode.getFoldingRanges(document);
  }
  onDocumentRemoved(document: TextDocument) {
    this.htmlMode.onDocumentRemoved(document);
  }
  dispose() {
    this.htmlMode.dispose();
  }
}
