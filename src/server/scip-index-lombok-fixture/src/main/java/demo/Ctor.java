package demo;

import lombok.Builder;

public class Ctor {
    private final String id;

    @Builder
    public Ctor(String id) {
        this.id = id;
    }
}
