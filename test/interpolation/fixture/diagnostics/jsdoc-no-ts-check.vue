<template>
  <div>
    <div>{{ onlyNumber(msg) }}</div>
  </div>
</template>

<script>
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
