import { CompletionItem, CompletionItemKind, ConfigurationTarget, MarkdownString, workspace } from 'vscode';
import { getDocUri } from '../../path';
import { testCompletion, testNoSuchCompletion } from '../../../completionHelper';
import { position } from '../../../util';

describe('Should autocomplete interpolation for <template> in property class component', () => {
  const templateDocUri = getDocUri('completion/propertyDecorator/Child.vue');
  const parentTemplateDocUri = getDocUri('completion/propertyDecorator/Parent.vue');

  const defaultList: CompletionItem[] = [
    {
      label: 'foo',
      documentation: new MarkdownString('My foo').appendCodeblock(`@Prop({ type: Boolean, default: false }) foo`, 'js'),
      kind: CompletionItemKind.Field
    },
    {
      label: 'msg',
      documentation: new MarkdownString('My msg').appendCodeblock(`msg = 'Vetur means "Winter" in icelandic.'`, 'js'),
      kind: CompletionItemKind.Field
    },
    {
      label: 'count',
      documentation: new MarkdownString('My count').appendCodeblock(
        `get count () {
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

    it(`completes child component tag`, async () => {
      await testCompletion(parentTemplateDocUri, position(5, 5), [
        {
          label: 'basic-property-class',
          kind: CompletionItemKind.Property,
          documentationStart: 'My basic tag\n```js\n@Component('
        }
      ]);
    });

    const propsList = [
      {
        label: ':foo',
        kind: CompletionItemKind.Value,
        documentation: new MarkdownString('My foo').appendCodeblock(
          `@Prop({ type: Boolean, default: false }) foo`,
          'js'
        )
      },
      {
        label: ':bar',
        kind: CompletionItemKind.Value,
        documentation: new MarkdownString('My bar').appendCodeblock(
          `@PropSync('bar', { type: String }) syncedBar`,
          'js'
        )
      },
      {
        label: ':checked',
        kind: CompletionItemKind.Value,
        documentation: new MarkdownString('My checked').appendCodeblock(
          `@Model('change', { type: Boolean }) checked`,
          'js'
        )
      }
    ];

    it(`completes child component's props`, async () => {
      await testCompletion(parentTemplateDocUri, position(2, 26), propsList);
    });

    it(`completes child component's props when camel case component name`, async () => {
      await testCompletion(parentTemplateDocUri, position(4, 24), propsList);
    });

    it(`completes child component's emits`, async () => {
      const c = workspace.getConfiguration();
      await c.update('vetur.completion.attributeCasing', 'kebab', ConfigurationTarget.Global);

      await testCompletion(parentTemplateDocUri, position(2, 27), [
        {
          label: 'baz',
          kind: CompletionItemKind.Function,
          documentation: new MarkdownString('My baz')
            .appendCodeblock(
              `@Emit('baz')
baz() {}`,
              'js'
            )
            .appendText('\n')
            .appendMarkdown('My baz2')
            .appendCodeblock(
              `@Emit('baz')
baz2() {}`,
              'js'
            )
        },
        {
          label: 'foo-bar',
          kind: CompletionItemKind.Function,
          documentation: new MarkdownString('My fooBar').appendCodeblock(
            `@Emit()
fooBar() {}`,
            'js'
          )
        }
      ]);
    });

    it('completes inside v-if=""', async () => {
      await testCompletion(parentTemplateDocUri, position(3, 32), defaultList);
    });
    it(`doesn't completes on the edge " of v-if=""`, async () => {
      await testNoSuchCompletion(parentTemplateDocUri, position(3, 31), defaultList);
    });
    it(`doesn't completes on the edge " of v-if=""`, async () => {
      await testNoSuchCompletion(parentTemplateDocUri, position(3, 33), defaultList);
    });

    it('completes inside @click=""', async () => {
      await testCompletion(parentTemplateDocUri, position(3, 42), defaultList);
    });
    it(`doesn't completes on the edge " of @click=""`, async () => {
      await testNoSuchCompletion(parentTemplateDocUri, position(3, 41), defaultList);
    });
    it(`doesn't completes on the edge " of @click=""`, async () => {
      await testNoSuchCompletion(parentTemplateDocUri, position(3, 43), defaultList);
    });

    it('completes inside :foo=""', async () => {
      await testCompletion(parentTemplateDocUri, position(3, 50), defaultList);
    });
    it(`doesn't completes on the edge " of :foo=""`, async () => {
      await testNoSuchCompletion(parentTemplateDocUri, position(3, 49), defaultList);
    });
    it(`doesn't completes on the edge " of :foo=""`, async () => {
      await testNoSuchCompletion(parentTemplateDocUri, position(3, 51), defaultList);
    });
  });
});
