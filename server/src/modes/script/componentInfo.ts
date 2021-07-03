import { camelCase, kebabCase } from 'lodash';
import type ts from 'typescript';
import { BasicComponentInfo } from '../../config';
import { RuntimeLibrary } from '../../services/dependencyService';
import {
  VueFileInfo,
  EmitInfo,
  PropInfo,
  ComputedInfo,
  DataInfo,
  MethodInfo,
  ChildComponent
} from '../../services/vueInfoService';
import { analyzeComponentsDefine } from './childComponents';
import { getGlobalComponents } from './globalComponents';

type AttributeCasing = 'kebab' | 'camel';

export function getComponentInfo(
  tsModule: RuntimeLibrary['typescript'],
  service: ts.LanguageService,
  fileFsPath: string,
  globalComponentInfos: BasicComponentInfo[],
  config: any
): VueFileInfo | undefined {
  const program = service.getProgram();
  if (!program) {
    return undefined;
  }

  const sourceFile = program.getSourceFile(fileFsPath);
  if (!sourceFile) {
    return undefined;
  }

  const checker = program.getTypeChecker();

  const defaultExportNode = getDefaultExportNode(tsModule, sourceFile);
  if (!defaultExportNode) {
    return undefined;
  }

  const vueFileInfo = analyzeDefaultExportExpr(
    tsModule,
    defaultExportNode,
    checker,
    config.vetur.completion.attributeCasing
  );

  const defaultExportType = checker.getTypeAtLocation(defaultExportNode);
  const componentsDefineInfo = analyzeComponentsDefine(
    tsModule,
    defaultExportType,
    checker,
    config.vetur.completion.tagCasing
  );

  if (componentsDefineInfo) {
    const { list: internalChildComponents, ...defineInfo } = componentsDefineInfo;
    const childComponents: ChildComponent[] = [];
    internalChildComponents.forEach(c => {
      childComponents.push({
        name: c.name,
        documentation: c.documentation,
        definition: c.definition,
        global: false,
        info: c.defaultExportNode
          ? analyzeDefaultExportExpr(tsModule, c.defaultExportNode, checker, config.vetur.completion.attributeCasing)
          : undefined
      });
    });
    vueFileInfo.componentInfo.childComponents = childComponents;
    vueFileInfo.componentInfo.componentsDefine = defineInfo;
  }

  const globalComponents = getGlobalComponents(
    tsModule,
    service,
    globalComponentInfos,
    config.vetur.completion.tagCasing
  );
  if (globalComponents.length > 0) {
    vueFileInfo.componentInfo.childComponents = [
      ...(vueFileInfo.componentInfo.childComponents ?? []),
      ...globalComponents.map(c => ({
        name: c.name,
        documentation: c.documentation,
        definition: c.definition,
        global: true,
        info: c.defaultExportNode
          ? analyzeDefaultExportExpr(tsModule, c.defaultExportNode, checker, config.vetur.completion.attributeCasing)
          : undefined
      }))
    ];
  }

  return vueFileInfo;
}

export function analyzeDefaultExportExpr(
  tsModule: RuntimeLibrary['typescript'],
  defaultExportNode: ts.Node,
  checker: ts.TypeChecker,
  attributeCasing: AttributeCasing
): VueFileInfo {
  const defaultExportType = checker.getTypeAtLocation(defaultExportNode);

  const insertInOptionAPIPos = getInsertInOptionAPIPos(tsModule, defaultExportType, checker);
  const emits = getEmits(tsModule, defaultExportType, checker, attributeCasing);
  const props = getProps(tsModule, defaultExportType, checker, attributeCasing);
  const data = getData(tsModule, defaultExportType, checker);
  const computed = getComputed(tsModule, defaultExportType, checker);
  const methods = getMethods(tsModule, defaultExportType, checker);

  return {
    componentInfo: {
      insertInOptionAPIPos,
      emits,
      props,
      data,
      computed,
      methods
    }
  };
}

export function getDefaultExportNode(
  tsModule: RuntimeLibrary['typescript'],
  sourceFile: ts.SourceFile
): ts.Node | undefined {
  const exportStmts = sourceFile.statements.filter(
    st => st.kind === tsModule.SyntaxKind.ExportAssignment || st.kind === tsModule.SyntaxKind.ClassDeclaration
  );
  if (exportStmts.length === 0) {
    return undefined;
  }
  const exportNode =
    exportStmts[0].kind === tsModule.SyntaxKind.ExportAssignment
      ? (exportStmts[0] as ts.ExportAssignment).expression
      : (exportStmts[0] as ts.ClassDeclaration);

  return getNodeFromExportNode(tsModule, exportNode);
}

function getInsertInOptionAPIPos(
  tsModule: RuntimeLibrary['typescript'],
  defaultExportType: ts.Type,
  checker: ts.TypeChecker
) {
  if (isClassType(tsModule, defaultExportType)) {
    const decoratorArgumentType = getClassDecoratorArgumentType(tsModule, defaultExportType, checker);
    if (decoratorArgumentType && decoratorArgumentType.symbol.valueDeclaration) {
      return decoratorArgumentType.symbol.valueDeclaration.getStart() + 1;
    }
  } else if (defaultExportType.symbol?.valueDeclaration) {
    return defaultExportType.symbol.valueDeclaration.getStart() + 1;
  }
  return undefined;
}

function getEmits(
  tsModule: RuntimeLibrary['typescript'],
  defaultExportType: ts.Type,
  checker: ts.TypeChecker,
  attributeCasing: AttributeCasing
): EmitInfo[] | undefined {
  // When there is @Emit and emits option both, use only emits option.
  const result: EmitInfo[] = getClassAndObjectInfo(
    tsModule,
    defaultExportType,
    checker,
    getClassEmits,
    getObjectEmits,
    true
  );

  return result.length === 0 ? undefined : result;

  function getEmitValidatorInfo(propertyValue: ts.Node): { hasValidator: boolean; typeString?: string } {
    /**
     * case `foo: null`
     */
    if (propertyValue.kind === tsModule.SyntaxKind.NullKeyword) {
      return { hasValidator: false };
    }

    /**
     * case `foo: function() {}` or `foo: () => {}`
     */
    if (tsModule.isFunctionExpression(propertyValue) || tsModule.isArrowFunction(propertyValue)) {
      let typeParameterText = '';
      if (propertyValue.typeParameters) {
        typeParameterText = `<${propertyValue.typeParameters.map(tp => tp.getText()).join(', ')}>`;
      }
      const parameterText = `(${propertyValue.parameters
        .map(p => `${p.getText()}${p.type ? '' : ': any'}`)
        .join(', ')})`;
      const typeString = `${typeParameterText}${parameterText} => any`;
      return { hasValidator: true, typeString };
    }

    return { hasValidator: false };
  }

  function getClassEmits(type: ts.Type) {
    const emitDecoratorNames = ['Emit'];
    const emitsSymbols = type
      .getProperties()
      .filter(
        property =>
          validPropertySyntaxKind(property, tsModule.SyntaxKind.MethodDeclaration) &&
          getPropertyDecoratorNames(property).some(decoratorName => emitDecoratorNames.includes(decoratorName))
      );
    if (emitsSymbols.length === 0) {
      return undefined;
    }

    // There maybe same emit name because @Emit can be put on multiple methods.
    const emitInfoMap = new Map<string, EmitInfo>();
    emitsSymbols.forEach(emitSymbol => {
      const emit = emitSymbol.valueDeclaration as ts.MethodDeclaration;
      const decoratorExpr = emit.decorators?.find(decorator =>
        tsModule.isCallExpression(decorator.expression)
          ? emitDecoratorNames.includes(decorator.expression.expression.getText())
          : false
      )?.expression as ts.CallExpression;
      const decoratorArgs = decoratorExpr.arguments;

      let name = kebabCase(emitSymbol.name);
      if (decoratorArgs.length > 0) {
        const firstNode = decoratorArgs[0];
        if (tsModule.isStringLiteral(firstNode)) {
          name = firstNode.text;
        }
      }

      const location = {
        start: 0,
        end: 0
      };

      if (emit.decorators && emit.decorators.length > 0) {
        location.end = emit.decorators[0].expression.getEnd() ?? 0;
        location.start = emit.decorators[0].expression.getStart() ?? 0;
      }

      let typeString: string | undefined = undefined;
      const signature = checker.getSignatureFromDeclaration(emit);
      if (signature) {
        const returnType = checker.getReturnTypeOfSignature(signature);
        typeString = `(${checker.typeToString(returnType)})`;
        if (typeString === '(void)') {
          typeString = '(undefined)';
        }
      }

      if (emitInfoMap.has(name)) {
        const oldEmitInfo = emitInfoMap.get(name)!;
        if (typeString) {
          // create union type
          oldEmitInfo.typeString += ` | ${typeString}`;
        } else {
          // remove type (because it failed to obtain the type)
          oldEmitInfo.typeString = undefined;
        }
        oldEmitInfo.documentation += `\n\n${buildDocumentation(tsModule, emitSymbol, checker)}`;
        emitInfoMap.set(name, oldEmitInfo);
      } else {
        emitInfoMap.set(name, {
          name: convertToCasing(name, attributeCasing),
          hasValidator: false,
          typeString,
          documentation: buildDocumentation(tsModule, emitSymbol, checker),
          location
        });
      }
    });

    const emitInfo = [...emitInfoMap.values()];
    emitInfo.forEach(info => {
      if (info.typeString) {
        info.typeString = `(arg: ${info.typeString}) => any`;
      }
    });

    return emitInfo;
  }

  function getObjectEmits(type: ts.Type) {
    const emitsSymbol = checker.getPropertyOfType(type, 'emits');
    if (!emitsSymbol || !emitsSymbol.valueDeclaration) {
      return undefined;
    }

    const emitsDeclaration = getLastChild(emitsSymbol.valueDeclaration);
    if (!emitsDeclaration) {
      return undefined;
    }

    /**
     * Plain array emits like `emits: ['foo', 'bar']`
     */
    if (emitsDeclaration.kind === tsModule.SyntaxKind.ArrayLiteralExpression) {
      return (emitsDeclaration as ts.ArrayLiteralExpression).elements
        .filter(expr => expr.kind === tsModule.SyntaxKind.StringLiteral)
        .map(expr => {
          return {
            name: convertToCasing((expr as ts.StringLiteral).text, attributeCasing),
            hasValidator: false,
            documentation: `\`\`\`js\n${formatJSLikeDocumentation(
              emitsDeclaration.parent.getFullText().trim()
            )}\n\`\`\`\n`,
            location: {
              start: emitsDeclaration.getStart(),
              end: emitsDeclaration.getEnd()
            }
          };
        });
    }

    /**
     * Object literal emits like
     * ```
     * {
     *   emits: {
     *     foo: () => true,
     *     bar: (arg1: string, arg2: number) => arg1.startsWith('s') || arg2 > 0,
     *     car: null
     *   }
     * }
     * ```
     */
    if (emitsDeclaration.kind === tsModule.SyntaxKind.ObjectLiteralExpression) {
      const emitsType = checker.getTypeOfSymbolAtLocation(emitsSymbol, emitsDeclaration);

      return checker.getPropertiesOfType(emitsType).map(s => {
        const node = getNodeFromSymbol(s);
        const status =
          node !== undefined && tsModule.isPropertyAssignment(node)
            ? getEmitValidatorInfo(node.initializer)
            : { hasValidator: false };

        return {
          name: convertToCasing(s.name, attributeCasing),
          ...status,
          documentation: buildDocumentation(tsModule, s, checker),
          location: {
            start: node?.getStart() ?? 0,
            end: node?.getEnd() ?? 0
          }
        };
      });
    }

    return undefined;
  }
}

function getProps(
  tsModule: RuntimeLibrary['typescript'],
  defaultExportType: ts.Type,
  checker: ts.TypeChecker,
  attributeCasing: AttributeCasing
): PropInfo[] | undefined {
  const result: PropInfo[] = markPropBoundToModel(
    defaultExportType,
    getClassAndObjectInfo(tsModule, defaultExportType, checker, getClassProps, getObjectProps)
  );

  return result.length === 0 ? undefined : result;

  function markPropBoundToModel(type: ts.Type, props: PropInfo[]) {
    function markValuePropBoundToModel() {
      return props.map(prop => {
        if (prop.name === 'value') {
          prop.isBoundToModel = true;
        }

        prop.name = convertToCasing(prop.name, attributeCasing);

        return prop;
      });
    }

    const modelSymbol = checker.getPropertyOfType(type, 'model');
    const modelValue = (modelSymbol?.valueDeclaration as ts.PropertyAssignment)?.initializer;
    // Set value prop when no model def
    if (!modelSymbol || !modelValue) {
      return markValuePropBoundToModel();
    }

    const modelType = checker.getTypeOfSymbolAtLocation(modelSymbol, modelValue);
    const modelPropSymbol = checker.getPropertyOfType(modelType, 'prop');
    const modelPropValue = (modelPropSymbol?.valueDeclaration as ts.PropertyAssignment)?.initializer;
    if (!modelPropValue || !tsModule.isStringLiteral(modelPropValue)) {
      return markValuePropBoundToModel();
    }

    return props.map(prop => {
      if (prop.name === modelPropValue.text) {
        prop.isBoundToModel = true;
      }

      prop.name = convertToCasing(prop.name, attributeCasing);

      return prop;
    });
  }

  function getPropValidatorInfo(propertyValue: ts.Node | undefined): {
    hasObjectValidator: boolean;
    required: boolean;
    typeString?: string;
  } {
    if (!propertyValue) {
      return { hasObjectValidator: false, required: true };
    }

    let typeString: string | undefined = undefined;
    let typeDeclaration: ts.Identifier | ts.AsExpression | undefined = undefined;

    /**
     * case `foo: { type: String }`
     * extract type value: `String`
     */
    if (tsModule.isObjectLiteralExpression(propertyValue)) {
      const propertyValueSymbol = checker.getTypeAtLocation(propertyValue).symbol;
      const typeValue = propertyValueSymbol?.members?.get('type' as ts.__String)?.valueDeclaration;
      if (typeValue && tsModule.isPropertyAssignment(typeValue)) {
        if (tsModule.isIdentifier(typeValue.initializer) || tsModule.isAsExpression(typeValue.initializer)) {
          typeDeclaration = typeValue.initializer;
        }
      }
    } else {
      /**
       * case `foo: String`
       * extract type value: `String`
       */
      if (tsModule.isIdentifier(propertyValue) || tsModule.isAsExpression(propertyValue)) {
        typeDeclaration = propertyValue;
      }
    }

    if (typeDeclaration) {
      /**
       * `String` case
       *
       * Per https://vuejs.org/v2/guide/components-props.html#Type-Checks, handle:
       *
       * String
       * Number
       * Boolean
       * Array
       * Object
       * Date
       * Function
       * Symbol
       */
      if (tsModule.isIdentifier(typeDeclaration)) {
        const vueTypeCheckConstructorToTSType: Record<string, string> = {
          String: 'string',
          Number: 'number',
          Boolean: 'boolean',
          Array: 'any[]',
          Object: 'object',
          Date: 'Date',
          Function: 'Function',
          Symbol: 'Symbol'
        };
        const vueTypeString = typeDeclaration.getText();
        if (vueTypeCheckConstructorToTSType[vueTypeString]) {
          typeString = vueTypeCheckConstructorToTSType[vueTypeString];
        }
      } else if (
        /**
         * `String as PropType<'a' | 'b'>` case
         */
        tsModule.isAsExpression(typeDeclaration) &&
        tsModule.isTypeReferenceNode(typeDeclaration.type) &&
        ['PropType', 'Vue.PropType'].includes(typeDeclaration.type.typeName.getText()) &&
        typeDeclaration.type.typeArguments &&
        typeDeclaration.type.typeArguments[0]
      ) {
        const extractedPropType = typeDeclaration.type.typeArguments[0];
        typeString = extractedPropType.getText();
      }
    }

    if (!propertyValue || !tsModule.isObjectLiteralExpression(propertyValue)) {
      return { hasObjectValidator: false, required: true, typeString };
    }

    const propertyValueSymbol = checker.getTypeAtLocation(propertyValue).symbol;
    const requiredValue = propertyValueSymbol?.members?.get('required' as ts.__String)?.valueDeclaration;
    const defaultValue = propertyValueSymbol?.members?.get('default' as ts.__String)?.valueDeclaration;
    if (!requiredValue && !defaultValue) {
      return { hasObjectValidator: false, required: true, typeString };
    }

    const required = Boolean(
      requiredValue &&
        tsModule.isPropertyAssignment(requiredValue) &&
        requiredValue?.initializer.kind === tsModule.SyntaxKind.TrueKeyword
    );

    return { hasObjectValidator: true, required, typeString };
  }

  function getClassProps(type: ts.Type) {
    const propDecoratorNames = ['Prop', 'Model', 'PropSync'];
    const propsSymbols = type
      .getProperties()
      .filter(
        property =>
          validPropertySyntaxKind(property, tsModule.SyntaxKind.PropertyDeclaration) &&
          getPropertyDecoratorNames(property).some(decoratorName => propDecoratorNames.includes(decoratorName))
      );
    if (propsSymbols.length === 0) {
      return undefined;
    }

    return propsSymbols.map(propSymbol => {
      const prop = propSymbol.valueDeclaration as ts.PropertyDeclaration;
      const decoratorExpr = prop.decorators?.find(decorator =>
        tsModule.isCallExpression(decorator.expression)
          ? propDecoratorNames.includes(decorator.expression.expression.getText())
          : false
      )?.expression as ts.CallExpression;
      const decoratorName = decoratorExpr.expression.getText();
      const [firstNode, secondNode] = decoratorExpr.arguments;

      const location = {
        start: 0,
        end: 0
      };

      if (prop.decorators && prop.decorators.length > 0) {
        location.end = prop.decorators[0].expression.getEnd() ?? 0;
        location.start = prop.decorators[0].expression.getStart() ?? 0;
      }

      if (decoratorName === 'PropSync' && tsModule.isStringLiteral(firstNode)) {
        return {
          name: firstNode.text,
          ...getPropValidatorInfo(secondNode),
          isBoundToModel: false,
          documentation: buildDocumentation(tsModule, propSymbol, checker),
          location
        };
      }

      return {
        name: propSymbol.name,
        ...getPropValidatorInfo(decoratorName === 'Model' ? secondNode : firstNode),
        isBoundToModel: decoratorName === 'Model',
        documentation: buildDocumentation(tsModule, propSymbol, checker),
        location
      };
    });
  }

  function getObjectProps(type: ts.Type) {
    const propsSymbol = checker.getPropertyOfType(type, 'props');
    if (!propsSymbol || !propsSymbol.valueDeclaration) {
      return undefined;
    }

    const propsDeclaration = getLastChild(propsSymbol.valueDeclaration);
    if (!propsDeclaration) {
      return undefined;
    }

    /**
     * Plain array props like `props: ['foo', 'bar']`
     */
    if (propsDeclaration.kind === tsModule.SyntaxKind.ArrayLiteralExpression) {
      return (propsDeclaration as ts.ArrayLiteralExpression).elements
        .filter(expr => expr.kind === tsModule.SyntaxKind.StringLiteral)
        .map(expr => {
          return {
            name: (expr as ts.StringLiteral).text,
            hasObjectValidator: false,
            required: true,
            isBoundToModel: false,
            documentation: `\`\`\`js\n${formatJSLikeDocumentation(
              propsDeclaration.parent.getFullText().trim()
            )}\n\`\`\`\n`,
            location: {
              start: expr.getStart(),
              end: expr.getEnd()
            }
          };
        });
    }

    /**
     * Object literal props like
     * ```
     * {
     *   props: {
     *     foo: { type: Boolean, default: true },
     *     bar: { type: String, default: 'bar' },
     *     car: String
     *   }
     * }
     * ```
     */
    if (propsDeclaration.kind === tsModule.SyntaxKind.ObjectLiteralExpression) {
      const propsType = checker.getTypeOfSymbolAtLocation(propsSymbol, propsDeclaration);

      return checker.getPropertiesOfType(propsType).map(s => {
        const node = getNodeFromSymbol(s);
        const status =
          node !== undefined && tsModule.isPropertyAssignment(node)
            ? getPropValidatorInfo(node.initializer)
            : { hasObjectValidator: false, required: true };

        return {
          name: s.name,
          ...status,
          isBoundToModel: false,
          documentation: buildDocumentation(tsModule, s, checker),
          location: {
            start: node?.getStart() ?? -1,
            end: node?.getEnd() ?? -1
          }
        };
      });
    }

    return undefined;
  }
}

/**
 * In SFC, data can only be a function
 * ```
 * {
 *   data() {
 *     return {
 *        foo: true,
 *        bar: 'bar'
 *     }
 *   }
 * }
 * ```
 */
function getData(
  tsModule: RuntimeLibrary['typescript'],
  defaultExportType: ts.Type,
  checker: ts.TypeChecker
): DataInfo[] | undefined {
  const result: DataInfo[] = getClassAndObjectInfo(tsModule, defaultExportType, checker, getClassData, getObjectData);
  return result.length === 0 ? undefined : result;

  function getClassData(type: ts.Type) {
    const noDataDecoratorNames = ['Prop', 'Model', 'Provide', 'ProvideReactive', 'Ref'];
    const dataSymbols = type
      .getProperties()
      .filter(
        property =>
          validPropertySyntaxKind(property, tsModule.SyntaxKind.PropertyDeclaration) &&
          !getPropertyDecoratorNames(property).some(decoratorName => noDataDecoratorNames.includes(decoratorName)) &&
          !property.name.startsWith('_') &&
          !property.name.startsWith('$')
      );
    if (dataSymbols.length === 0) {
      return undefined;
    }

    return dataSymbols.map(data => {
      return {
        name: data.name,
        documentation: buildDocumentation(tsModule, data, checker)
      };
    });
  }

  function getObjectData(type: ts.Type) {
    const dataSymbol = checker.getPropertyOfType(type, 'data');
    if (!dataSymbol || !dataSymbol.valueDeclaration) {
      return undefined;
    }

    const dataType = checker.getTypeOfSymbolAtLocation(dataSymbol, dataSymbol.valueDeclaration);
    const dataSignatures = dataType.getCallSignatures();
    if (dataSignatures.length === 0) {
      return undefined;
    }
    const dataReturnTypeProperties = checker.getReturnTypeOfSignature(dataSignatures[0]);
    return dataReturnTypeProperties.getProperties().map(s => {
      return {
        name: s.name,
        documentation: buildDocumentation(tsModule, s, checker)
      };
    });
  }
}

function getComputed(
  tsModule: RuntimeLibrary['typescript'],
  defaultExportType: ts.Type,
  checker: ts.TypeChecker
): ComputedInfo[] | undefined {
  const result: ComputedInfo[] = getClassAndObjectInfo(
    tsModule,
    defaultExportType,
    checker,
    getClassComputed,
    getObjectComputed
  );
  return result.length === 0 ? undefined : result;

  function getClassComputed(type: ts.Type) {
    const getAccessorSymbols = type
      .getProperties()
      .filter(property => property.valueDeclaration?.kind === tsModule.SyntaxKind.GetAccessor);
    const setAccessorSymbols = defaultExportType
      .getProperties()
      .filter(property => property.valueDeclaration?.kind === tsModule.SyntaxKind.SetAccessor);
    if (getAccessorSymbols.length === 0) {
      return undefined;
    }

    return getAccessorSymbols.map(computed => {
      const setComputed = setAccessorSymbols.find(setAccessor => setAccessor.name === computed.name);
      return {
        name: computed.name,
        documentation:
          buildDocumentation(tsModule, computed, checker) +
          (setComputed !== undefined ? buildDocumentation(tsModule, setComputed, checker) : '')
      };
    });
  }

  function getObjectComputed(type: ts.Type) {
    const computedSymbol = checker.getPropertyOfType(type, 'computed');
    if (!computedSymbol || !computedSymbol.valueDeclaration) {
      return undefined;
    }

    const computedDeclaration = getLastChild(computedSymbol.valueDeclaration);
    if (!computedDeclaration) {
      return undefined;
    }

    if (computedDeclaration.kind === tsModule.SyntaxKind.ObjectLiteralExpression) {
      const computedType = checker.getTypeOfSymbolAtLocation(computedSymbol, computedDeclaration);

      return checker.getPropertiesOfType(computedType).map(s => {
        return {
          name: s.name,
          documentation: buildDocumentation(tsModule, s, checker)
        };
      });
    }
  }
}

function isInternalHook(methodName: string) {
  const $internalHooks = [
    'data',
    'beforeCreate',
    'created',
    'beforeMount',
    'mounted',
    'beforeDestroy',
    'destroyed',
    'beforeUpdate',
    'updated',
    'activated',
    'deactivated',
    'render',
    'errorCaptured', // 2.5
    'serverPrefetch' // 2.6
  ];
  return $internalHooks.includes(methodName);
}

function getMethods(
  tsModule: RuntimeLibrary['typescript'],
  defaultExportType: ts.Type,
  checker: ts.TypeChecker
): MethodInfo[] | undefined {
  const result: MethodInfo[] = getClassAndObjectInfo(
    tsModule,
    defaultExportType,
    checker,
    getClassMethods,
    getObjectMethods
  );
  return result.length === 0 ? undefined : result;

  function getClassMethods(type: ts.Type) {
    const methodSymbols = type
      .getProperties()
      .filter(
        property =>
          validPropertySyntaxKind(property, tsModule.SyntaxKind.MethodDeclaration) &&
          !getPropertyDecoratorNames(property).some(decoratorName => decoratorName === 'Watch') &&
          !isInternalHook(property.name)
      );
    if (methodSymbols.length === 0) {
      return undefined;
    }

    return methodSymbols.map(method => {
      return {
        name: method.name,
        documentation: buildDocumentation(tsModule, method, checker)
      };
    });
  }

  function getObjectMethods(type: ts.Type) {
    const methodsSymbol = checker.getPropertyOfType(type, 'methods');
    if (!methodsSymbol || !methodsSymbol.valueDeclaration) {
      return undefined;
    }

    const methodsDeclaration = getLastChild(methodsSymbol.valueDeclaration);
    if (!methodsDeclaration) {
      return undefined;
    }

    if (methodsDeclaration.kind === tsModule.SyntaxKind.ObjectLiteralExpression) {
      const methodsType = checker.getTypeOfSymbolAtLocation(methodsSymbol, methodsDeclaration);

      return checker.getPropertiesOfType(methodsType).map(s => {
        return {
          name: s.name,
          documentation: buildDocumentation(tsModule, s, checker)
        };
      });
    }
  }
}

function getNodeFromExportNode(tsModule: RuntimeLibrary['typescript'], exportExpr: ts.Node): ts.Node | undefined {
  switch (exportExpr.kind) {
    case tsModule.SyntaxKind.CallExpression:
      // Vue.extend or synthetic __vueEditorBridge
      return (exportExpr as ts.CallExpression).arguments[0];
    case tsModule.SyntaxKind.ObjectLiteralExpression:
      return exportExpr as ts.ObjectLiteralExpression;
    case tsModule.SyntaxKind.ClassDeclaration:
      return exportExpr as ts.ClassDeclaration;
  }
  return undefined;
}

export function getLastChild(d: ts.Declaration) {
  const children = d.getChildren();
  if (children.length === 0) {
    return undefined;
  }

  return children[children.length - 1];
}

export function isClassType(tsModule: RuntimeLibrary['typescript'], type: ts.Type) {
  if (type.isClass === undefined) {
    return !!(
      (type.flags & tsModule.TypeFlags.Object ? (type as ts.ObjectType).objectFlags : 0) & tsModule.ObjectFlags.Class
    );
  } else {
    return type.isClass();
  }
}

export function getClassDecoratorArgumentType(
  tsModule: RuntimeLibrary['typescript'],
  defaultExportNode: ts.Type,
  checker: ts.TypeChecker
) {
  const decorators = defaultExportNode.symbol.valueDeclaration?.decorators;
  if (!decorators || decorators.length === 0) {
    return undefined;
  }

  if (!tsModule.isCallExpression(decorators?.[0].expression)) {
    return undefined;
  }

  const decoratorArguments = decorators?.[0].expression?.arguments;
  if (!decoratorArguments || decoratorArguments.length === 0) {
    return undefined;
  }

  return checker.getTypeAtLocation(decoratorArguments[0]);
}

function getClassAndObjectInfo<C, O>(
  tsModule: RuntimeLibrary['typescript'],
  defaultExportType: ts.Type,
  checker: ts.TypeChecker,
  getClassResult: (type: ts.Type) => C[] | undefined,
  getObjectResult: (type: ts.Type) => O[] | undefined,
  onlyUseObjectResultIfExists = false
) {
  const result: Array<C | O> = [];
  if (isClassType(tsModule, defaultExportType)) {
    const decoratorArgumentType = getClassDecoratorArgumentType(tsModule, defaultExportType, checker);
    if (decoratorArgumentType) {
      result.push.apply(result, getObjectResult(decoratorArgumentType) || []);
    }
    if (result.length === 0 || !onlyUseObjectResultIfExists) {
      result.push.apply(result, getClassResult(defaultExportType) || []);
    }
  } else {
    result.push.apply(result, getObjectResult(defaultExportType) || []);
  }
  return result;
}

function getNodeFromSymbol(property: ts.Symbol): ts.Declaration | undefined {
  return property.valueDeclaration ?? property.declarations?.[0];
}

function validPropertySyntaxKind(property: ts.Symbol, checkSyntaxKind: ts.SyntaxKind): boolean {
  return getNodeFromSymbol(property)?.kind === checkSyntaxKind;
}

function getPropertyDecoratorNames(property: ts.Symbol): string[] {
  const decorators = getNodeFromSymbol(property)?.decorators;
  if (decorators === undefined) {
    return [];
  }

  return decorators
    .map(decorator => decorator.expression as ts.CallExpression)
    .filter(decoratorExpression => decoratorExpression.expression !== undefined)
    .map(decoratorExpression => decoratorExpression.expression.getText());
}

export function buildDocumentation(tsModule: RuntimeLibrary['typescript'], s: ts.Symbol, checker: ts.TypeChecker) {
  let documentation = s
    .getDocumentationComment(checker)
    .map(d => d.text)
    .join('\n');

  documentation += '\n';

  const node = getNodeFromSymbol(s);
  if (node) {
    documentation += `\`\`\`js\n${formatJSLikeDocumentation(node.getText())}\n\`\`\`\n`;
  }

  return documentation;
}

function formatJSLikeDocumentation(src: string): string {
  const segments = src.split('\n');
  if (segments.length === 1) {
    return src;
  }

  const spacesToDeindent = segments[segments.length - 1].search(/\S/);

  return (
    segments[0] +
    '\n' +
    segments
      .slice(1)
      .map(s => s.slice(spacesToDeindent))
      .join('\n')
  );
}

function convertToCasing(text: string, casing: AttributeCasing) {
  switch (casing) {
    case 'camel': {
      return camelCase(text);
    }

    case 'kebab': {
      return kebabCase(text);
    }

    default:
      return text;
  }
}
