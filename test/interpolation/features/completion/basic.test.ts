import { CompletionItem, CompletionItemKind, ConfigurationTarget, MarkdownString, workspace } from 'vscode';
import { position } from '../../../util';
import { testCompletion, testNoSuchCompletion } from '../../../completionHelper';
import { getDocUri } from '../../path';

describe('Should autocomplete interpolation for <template>', () => {
  const templateDocUri = getDocUri('completion/Basic.vue');
  const parentTemplateDocUri = getDocUri('completion/Parent.vue');

  const defaultList: CompletionItem[] = [
    {
      label: 'foo',
      documentation: new MarkdownString('My foo').appendCodeblock(
        `foo: {
  type: Boolean,
  default: false
}`,
        'js'
      ),
      kind: CompletionItemKind.Field
    },
    {
      label: 'msg',
      documentation: new MarkdownString('My msg').appendCodeblock(`msg: 'Vetur means "Winter" in icelandic.'`, 'js'),
      kind: CompletionItemKind.Field
    },
    {
      label: 'count',
      documentation: new MarkdownString('My count').appendCodeblock(
        `count () {
  return this.$store.state.count
}`,
        'js'
      ),
      kind: CompletionItemKind.Field
    },
    {
      label: 'hello',
      documentation: new MarkdownString('My greeting').appendCodeblock(
        `hello () {
  console.log(this.msg)
}`,
        'js'
      ),

      kind: CompletionItemKind.Function
    }
  ];

  describe('Should complete props, data, computed and methods', () => {
    it('completes inside {{ }}', async () => {
      await testCompletion(templateDocUri, position(2, 7), defaultList);
    });

    it('completes an object property', async () => {
      await testCompletion(templateDocUri, position(3, 11), [
        {
          label: 'msg',
          kind: CompletionItemKind.Field
        }
      ]);
    });

    it(`completes child component tag (initial tag casing)`, async () => {
      const c = workspace.getConfiguration();
      await c.update('vetur.completion.tagCasing', 'initial', ConfigurationTarget.Global);

      await testCompletion(parentTemplateDocUri, position(6, 5), [
        {
          label: 'Basic',
          kind: CompletionItemKind.Property,
          documentationStart: 'My basic tag\n```js\nexport default {'
        }
      ]);
    });

    it(`completes child component tag (kebab tag casing)`, async () => {
      const c = workspace.getConfiguration();
      await c.update('vetur.completion.tagCasing', 'kebab', ConfigurationTarget.Global);

      await testCompletion(parentTemplateDocUri, position(6, 5), [
        {
          label: 'basic',
          kind: CompletionItemKind.Property,
          documentationStart: 'My basic tag\n```js\nexport default {'
        }
      ]);
    });

    it(`completes child component's props`, async () => {
      await testCompletion(parentTemplateDocUri, position(2, 12), [
        {
          label: ':foo',
          kind: CompletionItemKind.Value,
          documentation: new MarkdownString('My foo').appendCodeblock(
            `foo: {
  type: Boolean,
  default: false
}`,
            'js'
          )
        }
      ]);
    });

    it(`completes child component's props when kebab case component name`, async () => {
      await testCompletion(parentTemplateDocUri, position(4, 15), [
        {
          label: ':bar',
          kind: CompletionItemKind.Value,
          documentation: new MarkdownString('My bar').appendCodeblock(`bar: String`, 'js')
        }
      ]);
    });

    it(`completes child component's props when camel case component name`, async () => {
      await testCompletion(parentTemplateDocUri, position(5, 14), [
        {
          label: ':bar',
          kind: CompletionItemKind.Value,
          documentation: new MarkdownString('My bar').appendCodeblock(`bar: String`, 'js')
        }
      ]);
    });

    it('completes inside v-if=""', async () => {
      await testCompletion(parentTemplateDocUri, position(3, 17), defaultList);
    });
    it(`doesn't completes on the edge " of v-if=""`, async () => {
      await testNoSuchCompletion(parentTemplateDocUri, position(3, 16), defaultList);
    });
    it(`doesn't completes on the edge " of v-if=""`, async () => {
      await testNoSuchCompletion(parentTemplateDocUri, position(3, 18), defaultList);
    });

    it('completes inside @click=""', async () => {
      await testCompletion(parentTemplateDocUri, position(3, 27), defaultList);
    });
    it(`doesn't completes on the edge " of @click=""`, async () => {
      await testNoSuchCompletion(parentTemplateDocUri, position(3, 26), defaultList);
    });
    it(`doesn't completes on the edge " of @click=""`, async () => {
      await testNoSuchCompletion(parentTemplateDocUri, position(3, 28), defaultList);
    });

    it('completes inside :foo=""', async () => {
      await testCompletion(parentTemplateDocUri, position(3, 35), defaultList);
    });
    it(`doesn't completes on the edge " of :foo=""`, async () => {
      await testNoSuchCompletion(parentTemplateDocUri, position(3, 34), defaultList);
    });
    it(`doesn't completes on the edge " of :foo=""`, async () => {
      await testNoSuchCompletion(parentTemplateDocUri, position(3, 36), defaultList);
    });
  });
});
