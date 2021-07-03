<template>
  <div>
    <basic-property-class @></basic-property-class>
    <basic-property-class v-if="" @click="" :foo="" ></basic-property-class>
    <BasicPropertyClass  />
    <
  </div>
</template>

<script>
import Vue from 'vue'
import BasicPropertyClass from './Child.vue'
import { Prop, Component } from 'vue-property-decorator'

@Component({
  components: {
    BasicPropertyClass
  }
})
export default class ParentClass extends Vue {
  /**
   * My foo
   */
  @Prop({ type: Boolean, default: false }) foo

  /**
   * My msg
   */
  msg = 'Vetur means "Winter" in icelandic.'

  /**
   * My count
   */
  get count () {
    return this.$store.state.count
  }

  /**
   * My greeting
   */
  hello () {
    console.log(this.msg)
  }
}
</script>
