<template>
  <div class="hello">
    <div
      v-for="room in rooms"
      :key="room.name"
    >
      {{ room.name }}
      <div
        v-for="device in room.devices"
        :key="device.id"
        class="tile"
      >
        <div
          v-for="(option, index) in device.options"
          :key="index"
          class="action"
          @click="changeMode(device, option.value)"
        >
          {{ option.label }}
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { Component, Prop, Vue } from 'vue-property-decorator'

@Component({
  inject: ['ws']
})
export default class HelloWorld extends Vue {
  ws!: WebSocket

  @Prop() private msg!: string;

  rooms = []

  created () {
    this.ws.onmessage = ev => {
      const data = JSON.parse(ev.data)
      console.log(data)
      this.rooms = data.rooms
    }
  }

  isNumber (v) {
    return Number.isInteger(v)
  }

  changeMode (device, value) {
    this.ws.send(JSON.stringify({
      sourceId: device.sourceId,
      targetId: device.targetId,
      template: device.template,
      value: value
    }))
  }
}
</script>

<!-- Add "scoped" attribute to limit CSS to this component only -->
<style scoped lang="scss">
.tile {
  width: 200px;
  height: 200px;
  background: #000;
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  align-content: center;

  .action {
    width: 50px;
    height: 50px;
    background: #fff;
    border: 1px solid black;
    border-radius: 50%;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
  }
}
</style>
