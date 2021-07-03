<template>
  <div></div>
</template>

<script>
import Vue from 'vue'
import Component from 'vue-class-component'

@Component({})
export default class BasicClass extends Vue {
  @Prop({ type: Boolean, default: false }) fooProperty

  @Emit('fooEvent')
  public fooEvent() {

  }
}
</script>
