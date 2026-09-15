# { "Depends": "py-genlayer:9b8kjyda2ycxyq4ea6g4yfpnydxhd52gqba5rb8dw7krkh5mn9p0" }

import genlayer as gl


class Hello(gl.contract.Contract):
    def __init__(self):
        pass

    @gl.public.view
    def hello(self) -> str:
        return "hello"
