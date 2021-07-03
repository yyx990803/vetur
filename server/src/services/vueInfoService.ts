import { TextDocument } from 'vscode-languageserver-textdocument';
import { getFileFsPath } from '../utils/paths';
import { Definition } from 'vscode-languageserver-types';
import { LanguageModes } from '../embeddedSupport/languageModes';

/**
 * State associated with a specific Vue file
 * The state is shared between different modes
 */
export interface VueFileInfo {
  /**
   * The defualt export component info from script section
   */
  componentInfo: ComponentInfo;
}

export interface ComponentInfo {
  name?: string;
  definition?: Definition;

  insertInOptionAPIPos?: number;
  componentsDefine?: {
    start: number;
    end: number;
    insertPos: number;
  };
  childComponents?: ChildComponent[];

  emits?: EmitInfo[];
  /**
   * Todo: Extract type info in cases like
   * props: {
   *   foo: String
   * }
   */
  props?: PropInfo[];
  data?: DataInfo[];
  computed?: ComputedInfo[];
  methods?: MethodInfo[];
}

export interface ChildComponent {
  name: string;
  documentation?: string;
  definition?: {
    path: string;
    start: number;
    end: number;
  };
  global: boolean;
  info?: VueFileInfo;
}

export interface EmitInfo {
  name: string;
  /**
   * `true` if
   * emits: {
   *   foo: (...) => {...}
   * }
   *
   * `false` if
   * - `emits: ['foo']`
   * - `@Emit()`
   * - `emits: { foo: null }`
   */
  hasValidator: boolean;
  documentation?: string;
  typeString?: string;
  location: { start: number; end: number };
}

export interface PropInfo {
  name: string;
  /**
   * `true` if
   * props: {
   *   foo: { ... }
   * }
   *
   * `false` if
   * - `props: ['foo']`
   * - `props: { foo: String }`
   *
   */
  hasObjectValidator: boolean;
  required: boolean;
  isBoundToModel: boolean;
  documentation?: string;
  typeString?: string;
  location: { start: number; end: number };
}
export interface DataInfo {
  name: string;
  documentation?: string;
}
export interface ComputedInfo {
  name: string;
  documentation?: string;
}
export interface MethodInfo {
  name: string;
  documentation?: string;
}

export class VueInfoService {
  private languageModes: LanguageModes;
  private vueFileInfo: Map<string, VueFileInfo> = new Map();

  constructor() {}

  init(languageModes: LanguageModes) {
    this.languageModes = languageModes;
  }

  updateInfo(doc: TextDocument, info: VueFileInfo) {
    this.vueFileInfo.set(getFileFsPath(doc.uri), info);
  }

  getInfo(doc: TextDocument) {
    this.languageModes.getAllLanguageModeRangesInDocument(doc).forEach(m => {
      if (m.mode.updateFileInfo) {
        m.mode.updateFileInfo(doc);
      }
    });
    return this.vueFileInfo.get(getFileFsPath(doc.uri));
  }
}
