import { LanguageModes } from '../modes/languageModes';
import { getFileFsPath } from '../utils/paths';
import { Definition } from 'vscode-languageserver-types';
import { DocumentInfo } from './documentService';

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

  childComponents?: ChildComponent[];

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
  info?: VueFileInfo;
}

export interface PropInfo {
  name: string;
  documentation?: string;
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
  private vueFileInfo: Map<string, VueFileInfo> = new Map();

  constructor(private languageModes: LanguageModes) {}

  updateInfo(doc: DocumentInfo, info: VueFileInfo) {
    this.vueFileInfo.set(getFileFsPath(doc.uri), info);
  }

  getInfo(doc: DocumentInfo) {
    this.languageModes.getAllModesInDocument(doc).forEach(m => {
      if (m.updateFileInfo) {
        m.updateFileInfo(doc);
      }
    });
    return this.vueFileInfo.get(getFileFsPath(doc.uri));
  }
}
