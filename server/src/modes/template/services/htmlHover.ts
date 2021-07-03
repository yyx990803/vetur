import { HTMLDocument } from '../parser/htmlParser';
import { TokenType, createScanner } from '../parser/htmlScanner';
import { Range, Position, Hover, MarkupContent } from 'vscode-languageserver-types';
import type { TextDocument } from 'vscode-languageserver-textdocument';
import { IHTMLTagProvider } from '../tagProviders';
import { NULL_HOVER } from '../../nullMode';
import { toMarkupContent } from '../../../utils/strings';
import { kebabCase } from 'lodash';
import { normalizeAttributeNameToKebabCase } from './htmlCompletion';
import { AttributeCollector, TagCollector } from '../tagProviders/common';

const TRIVIAL_TOKEN = [TokenType.StartTagOpen, TokenType.EndTagOpen, TokenType.Whitespace];

export function doHover(
  document: TextDocument,
  position: Position,
  htmlDocument: HTMLDocument,
  tagProviders: IHTMLTagProvider[]
): Hover {
  const offset = document.offsetAt(position);
  const node = htmlDocument.findNodeAt(offset);
  if (!node || !node.tag) {
    return NULL_HOVER;
  }

  function getTagHover(tag: string, range: Range, open: boolean): Hover {
    tag = kebabCase(tag);

    let hover: Hover | null = null;
    const tagCollector: TagCollector = (resolvedTag, documentation) => {
      if (resolvedTag !== tag && kebabCase(resolvedTag) !== tag) {
        return;
      }
      hover = { contents: toMarkupContent(documentation), range };
    };

    for (const provider of tagProviders) {
      provider.collectTags(tagCollector);
      if (hover) {
        return hover;
      }
    }
    return NULL_HOVER;
  }

  function getAttributeHover(tag: string, attribute: string, range: Range): Hover {
    tag = kebabCase(tag);
    const isEventAttribute = attribute.startsWith('@');

    let hover: Hover | null = null;
    const attributeCollector: AttributeCollector = (attr, type?, documentation?) => {
      if (type === 'event' && !isEventAttribute) {
        return;
      }

      if (type !== 'event' && isEventAttribute) {
        return;
      }

      if (normalizeAttributeNameToKebabCase(attribute) !== normalizeAttributeNameToKebabCase(attr)) {
        return;
      }

      hover = { contents: toMarkupContent(documentation), range };
    };

    for (const provider of tagProviders) {
      provider.collectAttributes(tag, attributeCollector);
      if (hover) {
        return hover;
      }
    }
    return NULL_HOVER;
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
    return NULL_HOVER;
  }
  const tagRange = {
    start: document.positionAt(scanner.getTokenOffset()),
    end: document.positionAt(scanner.getTokenEnd())
  };
  switch (token) {
    case TokenType.StartTag:
      return getTagHover(node.tag, tagRange, true);
    case TokenType.EndTag:
      return getTagHover(node.tag, tagRange, false);
    case TokenType.AttributeName:
      // TODO: treat : as special bind
      const attribute = scanner.getTokenText().replace(/^:/, '');
      return getAttributeHover(node.tag, attribute, tagRange);
  }

  return NULL_HOVER;
}
