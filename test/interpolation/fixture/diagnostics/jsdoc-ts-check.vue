<template>
  <div>
    <div>{{ onlyNumber(msg) }}</div>
  </div>
</template>

<script>
// @ts-check
export default {
  data () {
    return {
      msg: 'foo',
    }
  },
  methods: {
    /**
     * @param {number} num
     */
    onlyNumber(num) {}
  }
}
</script>
