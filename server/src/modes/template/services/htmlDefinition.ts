import { HTMLDocument } from '../parser/htmlParser';
import { TokenType, createScanner } from '../parser/htmlScanner';
import { Range, Position, Location } from 'vscode-languageserver-types';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { VueFileInfo } from '../../../services/vueInfoService';
import { URI } from 'vscode-uri';
import { kebabCase } from 'lodash';
import { DocumentService } from '../../../services/documentService';
import fs from 'fs';

const TRIVIAL_TOKEN = [TokenType.StartTagOpen, TokenType.EndTagOpen, TokenType.Whitespace];

export function findDefinition(
  document: TextDocument,
  position: Position,
  htmlDocument: HTMLDocument,
  documentService: DocumentService,
  vueFileInfo?: VueFileInfo
): Location[] {
  const offset = document.offsetAt(position);
  const node = htmlDocument.findNodeAt(offset);
  if (!node || !node.tag) {
    return [];
  }

  function getTagDefinition(tag: string, range: Range, open: boolean): Location[] {
    if (vueFileInfo && vueFileInfo.componentInfo.childComponents) {
      for (const cc of vueFileInfo.componentInfo.childComponents) {
        if (![tag, tag.toLowerCase(), kebabCase(tag)].includes(cc.name.toLowerCase())) {
          continue;
        }
        if (!cc.definition) {
          continue;
        }

        const fileUri = URI.file(cc.definition.path).toString();
        const targetDocument = getDocumentByFileUriSchemeOrPath(cc.definition.path, fileUri);

        let range: Range | null = null;

        if (targetDocument) {
          range = Range.create(
            targetDocument.positionAt(cc.definition.start),
            targetDocument.positionAt(cc.definition.end)
          );
        }

        const loc: Location = {
          uri: URI.file(cc.definition.path).toString(),
          range: range ?? Range.create(0, 0, 0, 0)
        };
        return [loc];
      }
    }
    return [];
  }

  function getAttributeDefinition(tagName: string, attributeName: string): Location[] {
    tagName = kebabCase(tagName);

    if (vueFileInfo && vueFileInfo.componentInfo.childComponents) {
      for (const cc of vueFileInfo.componentInfo.childComponents) {
        if (
          !cc.definition ||
          !cc.info ||
          !cc.info.componentInfo ||
          (cc.name !== tagName && kebabCase(cc.name) !== tagName)
        ) {
          continue;
        }

        let targetDocument: TextDocument | null = null;
        const fileUri = URI.file(cc.definition.path).toString();
        let startPos = 0;
        let endPos = 0;

        targetDocument = getDocumentByFileUriSchemeOrPath(cc.definition.path, fileUri);

        if (attributeName.startsWith('@')) {
          attributeName = attributeName.slice(1);
          const emitData = cc.info.componentInfo.emits?.filter(
            x => x.name.toLowerCase() === attributeName.toLowerCase() || kebabCase(x.name) === kebabCase(attributeName)
          )[0];
          if (!emitData || !emitData.location) {
            continue;
          }

          if (targetDocument) {
            startPos = emitData.location.start;
            endPos = emitData.location.end;
          }
        } else {
          if (attributeName.startsWith(':')) {
            attributeName = attributeName.slice(1);
          }

          const propData = cc.info.componentInfo.props?.filter(x => kebabCase(x.name) === kebabCase(attributeName))[0];
          if (!propData || !propData.location) {
            continue;
          }

          if (targetDocument) {
            startPos = propData.location.start;
            endPos = propData.location.end;
          }
        }

        const loc: Location = {
          uri: URI.file(cc.definition.path).toString(),
          range: targetDocument
            ? Range.create(targetDocument.positionAt(startPos), targetDocument.positionAt(endPos))
            : Range.create(0, 0, 0, 0)
        };
        return [loc];
      }
    }
    return [];
  }

  function getDocumentByFileUriSchemeOrPath(path: string, fileUri: string) {
    let document = documentService.getDocument(fileUri);

    if (document) {
      return document;
    }

    // We need to read the file in case it was never opened and does not exist in documentService yet
    document = TextDocument.create(fileUri, 'vue', 0, fs.readFileSync(path).toString());
    return document;
  }

  const inEndTag = node.endTagStart && offset >= node.endTagStart; // <html></ht|ml>
  const startOffset = inEndTag ? node.endTagStart : node.start;
  const scanner = createScanner(document.getText(), startOffset);
  let token = scanner.scan();

  function shouldAdvance() {
    if (token === TokenType.EOS) {
      return false;
    }
    const tokenEnd = scanner.getTokenEnd();
    if (tokenEnd < offset) {
      return true;
    }

    if (tokenEnd === offset) {
      return TRIVIAL_TOKEN.includes(token);
    }
    return false;
  }

  while (shouldAdvance()) {
    token = scanner.scan();
  }

  if (offset > scanner.getTokenEnd()) {
    return [];
  }
  const tagRange = {
    start: document.positionAt(scanner.getTokenOffset()),
    end: document.positionAt(scanner.getTokenEnd())
  };
  switch (token) {
    case TokenType.StartTag:
      return getTagDefinition(node.tag, tagRange, true);
    case TokenType.EndTag:
      return getTagDefinition(node.tag, tagRange, false);
    case TokenType.AttributeName:
      const attributeName = scanner.getTokenText();
      const tagName = node.tag;
      return getAttributeDefinition(tagName, attributeName);
  }

  return [];
}
