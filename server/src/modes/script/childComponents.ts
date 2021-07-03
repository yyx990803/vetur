import type ts from 'typescript';
import {
  getLastChild,
  buildDocumentation,
  getDefaultExportNode,
  getClassDecoratorArgumentType,
  isClassType
} from './componentInfo';
import { kebabCase } from 'lodash';
import { RuntimeLibrary } from '../../services/dependencyService';

export interface InternalChildComponent {
  name: string;
  documentation?: string;
  definition?: {
    path: string;
    start: number;
    end: number;
  };
  defaultExportNode?: ts.Node;
}

export function analyzeComponentsDefine(
  tsModule: RuntimeLibrary['typescript'],
  defaultExportType: ts.Type,
  checker: ts.TypeChecker,
  tagCasing = 'kebab'
): { start: number; end: number; insertPos: number; list: InternalChildComponent[] } | undefined {
  let componentsSymbol: ts.Symbol | undefined;

  if (!isClassType(tsModule, defaultExportType)) {
    componentsSymbol = checker.getPropertyOfType(defaultExportType, 'components');
  } else {
    // get decorator argument type when class
    const classDecoratorArgumentType = getClassDecoratorArgumentType(tsModule, defaultExportType, checker);
    if (!classDecoratorArgumentType) {
      return undefined;
    }
    componentsSymbol = checker.getPropertyOfType(classDecoratorArgumentType, 'components');
  }

  if (!componentsSymbol || !componentsSymbol.valueDeclaration) {
    return undefined;
  }

  const componentsDeclaration = getLastChild(componentsSymbol.valueDeclaration);
  if (!componentsDeclaration) {
    return undefined;
  }

  if (componentsDeclaration.kind === tsModule.SyntaxKind.ObjectLiteralExpression) {
    const componentsType = checker.getTypeOfSymbolAtLocation(componentsSymbol, componentsDeclaration);

    let insertPos = componentsDeclaration.getStart(componentsDeclaration.getSourceFile(), true) + 1;
    const result: InternalChildComponent[] = [];
    checker.getPropertiesOfType(componentsType).forEach((s, i, arr) => {
      if (!s.valueDeclaration) {
        return;
      }

      let componentName = s.name;
      if (tagCasing === 'kebab') {
        componentName = kebabCase(s.name);
      }

      if (i === arr.length - 1) {
        insertPos = s.valueDeclaration.getEnd();
      }

      let objectLiteralSymbol: ts.Symbol | undefined;
      if (s.valueDeclaration.kind === tsModule.SyntaxKind.PropertyAssignment) {
        objectLiteralSymbol =
          checker.getSymbolAtLocation((s.valueDeclaration as ts.PropertyAssignment).initializer) || s;
      } else if (s.valueDeclaration.kind === tsModule.SyntaxKind.ShorthandPropertyAssignment) {
        objectLiteralSymbol = checker.getShorthandAssignmentValueSymbol(s.valueDeclaration) || s;
      }

      if (!objectLiteralSymbol) {
        return;
      }

      if (objectLiteralSymbol.flags & tsModule.SymbolFlags.Alias) {
        const definitionSymbol = checker.getAliasedSymbol(objectLiteralSymbol);
        if (!definitionSymbol.valueDeclaration) {
          return;
        }

        const sourceFile = definitionSymbol.valueDeclaration.getSourceFile();
        const defaultExportNode = getDefaultExportNode(tsModule, sourceFile);
        if (!defaultExportNode) {
          return;
        }

        const definition = {
          start: 0,
          end: 0,
          path: sourceFile.fileName
        };

        // If export node is equal to '{}' it means that the vue file doesn't have <script> component.
        if (!tsModule.isObjectLiteralExpression(defaultExportNode) || defaultExportNode.properties.length > 0) {
          definition.start = defaultExportNode.getStart(sourceFile, true);
          definition.end = defaultExportNode.getEnd();
        }

        result.push({
          name: componentName,
          documentation: buildDocumentation(tsModule, definitionSymbol, checker),
          definition,
          defaultExportNode
        });
      }
    });

    return {
      start: componentsDeclaration.getStart(componentsDeclaration.getSourceFile(), true),
      end: componentsDeclaration.getEnd(),
      insertPos,
      list: result
    };
  }
}
