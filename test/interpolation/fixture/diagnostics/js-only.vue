<script>
  // Valid Vue component script + template, but would fail TS inference because of Vue 2 limitations
  
	export default {
		name: 'JSOnly',
		props: {
			groups: {
				type: Array,
				required: true
			}
		},
		computed: {
			config() {
				return { someKey: 'some value' }
			}
		}
	}
</script>

<template>
	<div>
		<h1>Information: {{ config.someKey }}</h1>
		<div
			v-for="group in groups"
			:key="group.id"
		>
			<h2>{{ group.label }}</h2>
		</div>
	</div>
</template>
