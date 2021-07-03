<template>
  <div>
    <child></child>
    <child />
    <child fooProperty="propValue"/>
    <child :fooProperty="'propValue'"/>
    <child foo-property="propValue"/>
    <child :foo-property="'propValue'"/>
    <child @fooEvent=""/>
    <child @foo-event=""/>
    <Child />
    
  </div>
</template>

<script>
import Vue from 'vue'
import Child from './Child.vue'
import Component from 'vue-class-component'

@Component({
  components: {
    Child
  },
})
export default class ParentClass extends Vue {}
</script>
