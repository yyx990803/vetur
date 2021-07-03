import { position, sameLineLocation, location } from '../../../util';
import { getDocUri } from '../../path';
import { testDefinition } from '../../../definitionHelper';
import { ConfigurationTarget, workspace } from 'vscode';

describe('Should find definition for vue-class-component components', async () => {
  const parentUri = getDocUri('definition/classComponent/Parent.vue');

  const c = workspace.getConfiguration();
  await c.update('vetur.completion.attributeCasing', 'initial', ConfigurationTarget.Global);

  it('finds definition for opening tag in <child></child>', async () => {
    const tagUri = getDocUri('definition/classComponent/Child.vue');
    await testDefinition(parentUri, position(2, 5), location(tagUri, 8, 0, 16, 1));
  });

  it('finds definition for closing tag in <child></child>', async () => {
    const tagUri = getDocUri('definition/classComponent/Child.vue');
    await testDefinition(parentUri, position(2, 13), location(tagUri, 8, 0, 16, 1));
  });

  it('finds definition for self-closing tag <child />', async () => {
    const tagUri = getDocUri('definition/classComponent/Child.vue');
    await testDefinition(parentUri, position(3, 5), location(tagUri, 8, 0, 16, 1));
  });

  it('finds definition for self-closing tag <Child /> (PascalCase)', async () => {
    const tagUri = getDocUri('definition/classComponent/Child.vue');
    await testDefinition(parentUri, position(10, 5), location(tagUri, 8, 0, 16, 1));
  });

  it('finds definition for child property fooProperty (no binding)', async () => {
    const tagUri = getDocUri('definition/classComponent/Child.vue');
    await testDefinition(parentUri, position(4, 11), location(tagUri, 10, 3, 10, 42));
  });

  it('finds definition for child property :fooProperty (with binding)', async () => {
    const tagUri = getDocUri('definition/classComponent/Child.vue');
    await testDefinition(parentUri, position(5, 11), location(tagUri, 10, 3, 10, 42));
  });

  it('finds definition for child property foo-property (no binding)', async () => {
    const tagUri = getDocUri('definition/classComponent/Child.vue');
    await testDefinition(parentUri, position(6, 11), location(tagUri, 10, 3, 10, 42));
  });

  it('finds definition for child property :foo-property (with binding)', async () => {
    const tagUri = getDocUri('definition/classComponent/Child.vue');
    await testDefinition(parentUri, position(7, 11), location(tagUri, 10, 3, 10, 42));
  });

  it('finds definition for child event @fooEvent', async () => {
    const tagUri = getDocUri('definition/classComponent/Child.vue');
    await testDefinition(parentUri, position(8, 11), location(tagUri, 12, 3, 12, 19));
  });

  it('finds definition for child event @foo-event', async () => {
    const tagUri = getDocUri('definition/classComponent/Child.vue');
    await testDefinition(parentUri, position(9, 11), location(tagUri, 12, 3, 12, 19));
  });
});
