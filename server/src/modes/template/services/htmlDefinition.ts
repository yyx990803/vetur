import { HTMLDocument } from '../parser/htmlParser';
import { TokenType, createScanner } from '../parser/htmlScanner';
import { TextDocument, Range, Position, Definition, Location } from 'vscode-languageserver-types';
import { VueFileInfo, MemberInfo, PositionInfo, ChildComponent } from '../../../services/vueInfoService';
import { URI } from 'vscode-uri';
import { kebabCase } from 'lodash';

const TRIVIAL_TOKEN = [TokenType.StartTagOpen, TokenType.EndTagOpen, TokenType.Whitespace];

export function findDefinition(
  document: TextDocument,
  position: Position,
  htmlDocument: HTMLDocument,
  vueFileInfo?: VueFileInfo
): Definition {
  const offset = document.offsetAt(position);
  const node = htmlDocument.findNodeAt(offset);
  if (!node || !node.tag) {
    return [];
  }

  function getTagDefinition(tag: string, range: Range, open: boolean): Definition {
    if (vueFileInfo && vueFileInfo.componentInfo.childComponents) {
      for (const cc of vueFileInfo.componentInfo.childComponents) {
        if (![tag, tag.toLowerCase(), kebabCase(tag)].includes(cc.name)) {
          continue;
        }
        if (!cc.definition) {
          continue;
        }

        const loc: Location = {
          uri: URI.file(cc.definition.path).toString(),
          range: cc?.info?.componentInfo?.position ? cc.info.componentInfo.position : Range.create(0, 0, 0, 0)
        };
        return loc;
      }
    }
    return [];
  }

  function getAttributeDefinition(fullAttributeName: string, range: Range): Definition {
    if (vueFileInfo && vueFileInfo.componentInfo.childComponents) {
      for (const cc of vueFileInfo.componentInfo.childComponents) {
        if (!cc.info || !cc.definition || cc.definition === undefined) {
          continue;
        }

        // TODO: add support for v-on and v-bind, only : and @ works for now.
        const attributeName = fullAttributeName.substr(1);

        if (cc.info.componentInfo) {
          if (fullAttributeName.startsWith(':')) {
            return buildDefinitions(cc.info.componentInfo.props, attributeName, cc);
          }

          if (fullAttributeName.startsWith('@')) {
            return buildDefinitions(cc.info.componentInfo.events, attributeName, cc);
          }
        }
      }
    }

    return [];
  }

  function buildDefinitions(
    collection: (PositionInfo & MemberInfo)[] | undefined,
    attributeName: string,
    childComponent: ChildComponent
  ): Location[] {
    if (!collection) {
      return [];
    }

    return collection
      .filter(p => p.name === attributeName)
      .map(p => {
        if (!childComponent.definition) {
          return [];
        }

        const loc: Location = {
          uri: URI.file(childComponent.definition.path).toString(),
          range: p.position ? p.position : Range.create(0, 0, 0, 0)
        };
        return loc;
      })
      .flatMap(x => x);
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
      return getAttributeDefinition(scanner.getTokenText(), tagRange);
  }

  return [];
}
