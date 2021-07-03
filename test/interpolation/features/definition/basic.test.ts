import { position, sameLineLocation, location } from '../../../util';
import { getDocUri } from '../../path';
import { testDefinition } from '../../../definitionHelper';

describe('Should find definition', () => {
  const docUri = getDocUri('definition/Basic.vue');

  it('finds definition for child tag', async () => {
    const tagUri = getDocUri('definition/Child.vue');
    await testDefinition(docUri, position(2, 5), location(tagUri, 5, 15, 9, 1));
  });

  it('finds definition for test-bar tag', async () => {
    const tagUri = getDocUri('definition/TestBar.vue');
    await testDefinition(docUri, position(3, 5), sameLineLocation(tagUri, 0, 0, 0));
  });

  it('finds definition for TestBar tag', async () => {
    const tagUri = getDocUri('definition/TestBar.vue');
    await testDefinition(docUri, position(4, 5), sameLineLocation(tagUri, 0, 0, 0));
  });
});
